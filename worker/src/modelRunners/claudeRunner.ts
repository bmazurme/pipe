import { spawn } from 'node:child_process';

import { CancelledError } from '../cancelled.js';

export interface RunResult {
  exitCode: number;
  output: string;
}

const MAX_OUTPUT_CHARS = 1024 * 1024;
const DEFAULT_KILL_GRACE_MS = 5000;

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
    const env = {
      ...process.env,
      ...(proxyUrl ? { HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, ALL_PROXY: proxyUrl } : {}),
      // A per-job credential (see bridge's named Claude tokens) overrides
      // whatever this process inherited at startup — absent/null leaves the
      // inherited value untouched, the same behavior as before this param
      // existed.
      ...(claudeToken ? { CLAUDE_CODE_OAUTH_TOKEN: claudeToken } : {}),
    };
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
