import { spawn } from 'node:child_process';

import { CancelledError } from '../cancelled.js';

export interface RunResult {
  exitCode: number;
  output: string;
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
export function runClaude(
  cwd: string,
  prompt: string,
  claudeModel: 'sonnet' | 'opus',
  onOutput: (chunk: string) => void,
  proxyUrl?: string,
  claudeToken?: string | null,
  timeoutMs?: number,
  killGraceMs = DEFAULT_KILL_GRACE_MS,
  signal?: AbortSignal,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    // Already asked to stop before there was anything to stop.
    if (signal?.aborted) {
      reject(new CancelledError());
      return;
    }

    const args = ['-p', prompt, '--dangerously-skip-permissions', '--model', claudeModel];
    // The CLI is a closed-source binary — worker can't control its HTTP
    // client directly, only hope it honors the standard proxy env vars (most
    // tools built on common HTTP libraries do). Set whichever flavor it
    // reads; unused ones are harmless.
    const env = buildClaudeEnv(process.env, proxyUrl, claudeToken);
    const child = spawn('claude', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env });

    let output = '';
    const collect = (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      output += text;
      // Keep only the tail — a runaway CLI must not grow this without bound.
      if (output.length > MAX_OUTPUT_CHARS) output = output.slice(-MAX_OUTPUT_CHARS);
      onOutput(text);
    };
    child.stdout?.on('data', collect);
    // stderr carries the real failure cause (auth, rate limit, bad model), so
    // it goes into the result's tail too, not just the streamed log.
    child.stderr?.on('data', collect);

    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const timeoutTimer =
      timeoutMs && timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            killTimer = setTimeout(() => child.kill('SIGKILL'), killGraceMs);
          }, timeoutMs)
        : undefined;
    // The owner's stop request: same SIGTERM → SIGKILL ladder as the deadline, but
    // the outcome is "cancelled", not "timed out".
    let cancelled = false;
    const onAbort = () => {
      if (cancelled) return;
      cancelled = true;
      child.kill('SIGTERM');
      clearTimeout(killTimer);
      killTimer = setTimeout(() => child.kill('SIGKILL'), killGraceMs);
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
      if (cancelled) {
        reject(new CancelledError());
        return;
      }
      if (timedOut) {
        reject(new Error(`claude timed out after ${Math.round((timeoutMs ?? 0) / 1000)}s and was killed`));
        return;
      }
      resolve({ exitCode: code ?? 1, output });
    });
  });
}
