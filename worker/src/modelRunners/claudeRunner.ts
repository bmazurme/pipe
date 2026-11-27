import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { CancelledError } from '../cancelled.js';
import { applyRunnerIdentity, asUser } from '../runAs.js';
import { ClaudeStreamParser, type ClaudeReport, type StreamDelta } from './claudeUsage.js';

export interface RunResult {
  exitCode: number;
  output: string;
  // Plan limits and cost of this run, when the CLI reported them.
  report?: ClaudeReport;
}

// A failed run that still carries what the CLI reported before it died (timeout).
export class ClaudeRunError extends Error {
  readonly report?: ClaudeReport;

  constructor(message: string, report?: ClaudeReport) {
    super(message);
    this.name = 'ClaudeRunError';
    this.report = report;
  }
}

const MAX_OUTPUT_CHARS = 1024 * 1024;
const DEFAULT_KILL_GRACE_MS = 5000;

// Variables worker's own secrets live in — never handed to the CLI, which runs
// an unrestricted shell against untrusted task content.
const DENIED_ENV = /^(BRIDGE_API_KEY|OPENAI_|DEEPSEEK_|QWEN_)|_FILE$/;
const ALLOWED_ENV =
  /^(PATH|HOME|LANG|TMPDIR|TERM|USER|SHELL|CLAUDE_CODE_OAUTH_TOKEN|(HTTP|HTTPS|ALL|NO)_PROXY|LC_.*|NODE_.*|XDG_.*)$/i;

// Allowlist of what the claude CLI child may inherit; the deny list wins over it.
export function buildClaudeEnv(
  base: NodeJS.ProcessEnv,
  proxyUrl?: string,
  claudeToken?: string | null,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined || DENIED_ENV.test(key) || !ALLOWED_ENV.test(key)) continue;
    env[key] = value;
  }
  // The CLI is a closed-source binary — worker can only hope it honors the
  // standard proxy env vars. Set whichever flavor it reads; unused are harmless.
  if (proxyUrl) Object.assign(env, { HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, ALL_PROXY: proxyUrl });
  // A per-job credential (bridge's named Claude tokens) overrides the inherited one.
  if (claudeToken) env.CLAUDE_CODE_OAUTH_TOKEN = claudeToken;
  return env;
}

// The command that starts the CLI. With WORKER_RUN_AS set it goes through `sudo -n -E -u <user>` (or `setpriv` in the container image, see runAs.ts), so
// job code runs as another OS user that cannot read the worker's own key and VPN config (see README "Two OS users").
export function claudeCommand(
  args: string[],
  runAs: string | undefined = process.env.WORKER_RUN_AS?.trim() || undefined,
): { command: string; args: string[] } {
  if (!runAs) return { command: 'claude', args };
  return asUser(runAs, ['claude', ...args]);
}

// A scratch directory for one run. With WORKER_RUN_AS it is group-writable (setgid), so the other user can write
// its results there and the worker can still collect them.
export function makeRunDir(parent: string, prefix: string, runAs: string | undefined = process.env.WORKER_RUN_AS?.trim() || undefined): string {
  const dir = mkdtempSync(path.join(parent, prefix));
  if (runAs) chmodSync(dir, 0o2770);
  return dir;
}

// What the worker wrote into a run directory (the unpacked parcel) is the worker's own: with the default umask its directories are 755 and its files
// 644, so the other user — in the same group, but only able to READ — could not change a single file, and every job that had to write failed with
// «no write permission» (the isolation, switched on by default, made this show; a job that only reads never noticed). The whole tree is opened to the
// group: directories rwx + setgid (what the runner creates there stays in the group and the worker can collect it), files rw. Symlinks are left alone.
export function shareRunDir(dir: string, runAs: string | undefined = process.env.WORKER_RUN_AS?.trim() || undefined): void {
  if (!runAs) return;
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        chmodSync(full, (statSync(full).mode & 0o7777) | 0o2770);
        walk(full);
      } else if (entry.isFile()) {
        chmodSync(full, (statSync(full).mode & 0o7777) | 0o660);
      }
    }
  };
  chmodSync(dir, 0o2770);
  walk(dir);
}

// Startup check for WORKER_RUN_AS: throws when the worker may not run the CLI as that user. It runs the very command a job runs
// (`sudo -n -E -u <user> claude --version`, or the setpriv form in the image), because the sudoers rule allows exactly that and nothing else: the previous
// check, `sudo -n -u <user> true`, was refused by the rule itself, so the worker refused to start whenever WORKER_RUN_AS was set and the isolation had never been on.
export function verifyRunAs(runAs: string, run: typeof spawnSync = spawnSync): void {
  const cmd = claudeCommand(['--version'], runAs);
  const result = run(cmd.command, cmd.args, { stdio: 'ignore' });
  if (result.error || result.status !== 0) {
    throw new Error(`WORKER_RUN_AS=${runAs} is set but "${cmd.command} ${cmd.args.join(' ')}" failed — check the sudoers rule (or, with WORKER_RUN_AS_VIA=setpriv, that the container keeps CAP_SETUID and CAP_SETGID) and that ${runAs} can run claude (see worker/README.md)`);
  }
}

// Unattended, non-interactive run: `-p` (print mode) makes Claude Code do one
// turn and exit instead of opening its REPL, and
// `--dangerously-skip-permissions` is required for that turn to actually
// edit files/run tools with nobody at the keyboard to approve them.
//
// That flag is exactly as dangerous as it sounds outside a throwaway
// sandbox — same warning as sync's own claudeRunner.ts, which this mirrors:
// worker MUST run each job in an isolated environment (this process's own
// dedicated, unprivileged OS user is the minimum bar; a container/VM is
// better). Do not point this at a shared server user account.
// Handle runClaude fills in: extendTo(totalMs) moves the limit to a new total, counted from the start.
export interface RunDeadline {
  extendTo: (totalMs: number) => void;
}

export function runClaude(
  cwd: string,
  prompt: string,
  claudeModel: string,
  onOutput: (chunk: string) => void,
  proxyUrl?: string,
  claudeToken?: string | null,
  timeoutMs?: number,
  killGraceMs = DEFAULT_KILL_GRACE_MS,
  signal?: AbortSignal,
  // The reply as it is written (text and any reasoning) — for a chat that shows progress.
  onDelta?: (delta: StreamDelta) => void,
  // Extra CLI arguments appended as they are (the limits probe uses a bare system prompt and no tools).
  extraArgs: string[] = [],
  // Lets the caller move the time limit while the CLI runs (the owner's "+30 мин").
  deadline?: RunDeadline,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    // Already asked to stop before there was anything to stop.
    if (signal?.aborted) {
      reject(new CancelledError());
      return;
    }

    // stream-json (which needs --verbose) is what carries the plan-limit and cost events; the reply text is
    // read back out of it, so callers still see the same text as with the plain format. The partial-message chunks
    // only feed `onDelta`; they never reach the job log.
    // The prompt goes on stdin, not argv: one argv element over 128 KiB makes spawn fail with E2BIG, and the issue text is not capped.
    const args = ['-p', '--dangerously-skip-permissions', '--model', claudeModel, '--output-format', 'stream-json', '--verbose', '--include-partial-messages', ...extraArgs];
    // The CLI is a closed-source binary — worker can't control its HTTP
    // client directly, only hope it honors the standard proxy env vars (most
    // tools built on common HTTP libraries do). Set whichever flavor it
    // reads; unused ones are harmless.
    const env = buildClaudeEnv(process.env, proxyUrl, claudeToken);
    // The worker's own HOME/USER are not the other user's (sudo sets them for the target user; setpriv does not, see runAs.ts).
    const runAsUser = process.env.WORKER_RUN_AS?.trim();

    if (runAsUser) applyRunnerIdentity(env, runAsUser);
    const cmd = claudeCommand(args);
    const child = spawn(cmd.command, cmd.args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env, detached: process.platform !== 'win32' });
    // A CLI that exits before reading everything closes the pipe (EPIPE); the exit code reports that, not this.
    child.stdin?.on('error', () => {});
    child.stdin?.end(prompt);

    let output = '';
    const collect = (text: string) => {
      output += text;
      // Keep only the tail — a runaway CLI must not grow this without bound.
      if (output.length > MAX_OUTPUT_CHARS) output = output.slice(-MAX_OUTPUT_CHARS);
      onOutput(text);
    };
    const stream = new ClaudeStreamParser(collect, onDelta);
    child.stdout?.on('data', (chunk: Buffer) => stream.push(chunk.toString('utf-8')));
    // stderr carries the real failure cause (auth, rate limit, bad model), so
    // it goes into the result's tail too, not just the streamed log.
    child.stderr?.on('data', (chunk: Buffer) => collect(chunk.toString('utf-8')));

    // The CLI leads its own process group, so the tool subprocesses it started die with it.
    const killTree = (sig: NodeJS.Signals) => {
      if (process.platform !== 'win32' && child.pid) {
        try {
          process.kill(-child.pid, sig);
          return;
        } catch {
          // no such group any more — fall back to the CLI itself
        }
      }
      child.kill(sig);
    };

    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let limitMs = timeoutMs && timeoutMs > 0 ? timeoutMs : 0;
    const startedAt = Date.now();
    const armDeadline = () => {
      clearTimeout(timeoutTimer);
      if (limitMs <= 0) return;
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        killTree('SIGTERM');
        killTimer = setTimeout(() => killTree('SIGKILL'), killGraceMs);
      }, Math.max(0, limitMs - (Date.now() - startedAt)));
    };
    armDeadline();
    if (deadline) {
      deadline.extendTo = (totalMs: number) => {
        // Only ever later, and only while the limit has not fired yet.
        if (limitMs <= 0 || timedOut || totalMs <= limitMs) return;
        limitMs = totalMs;
        armDeadline();
      };
    }
    // The owner's stop request: same SIGTERM → SIGKILL ladder as the deadline, but
    // the outcome is "cancelled", not "timed out".
    let cancelled = false;
    const onAbort = () => {
      if (cancelled) return;
      cancelled = true;
      killTree('SIGTERM');
      clearTimeout(killTimer);
      killTimer = setTimeout(() => killTree('SIGKILL'), killGraceMs);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const clearTimers = () => {
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', onAbort);
    };

    child.on('error', (error) => {
      clearTimers();
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error('"claude" binary not found on PATH — install Claude Code on this server first.'));
        return;
      }
      reject(error);
    });

    child.on('close', (code) => {
      clearTimers();
      // A grandchild that ignored SIGTERM must not outlive the CLI.
      if (timedOut || cancelled) killTree('SIGKILL');
      stream.end();
      const report = stream.report.limits || stream.report.usage ? stream.report : undefined;
      if (cancelled) {
        reject(new CancelledError(report));
        return;
      }
      if (timedOut) {
        reject(new ClaudeRunError(`claude timed out after ${Math.round(limitMs / 1000)}s and was killed`, report));
        return;
      }
      resolve({
        exitCode: code ?? 1,
        // The CLI's own final reply is the cleanest text; the collected stream is the fallback.
        output: stream.finalText !== null && code === 0 ? stream.finalText : output,
        ...(report ? { report } : {}),
      });
    });
  });
}
