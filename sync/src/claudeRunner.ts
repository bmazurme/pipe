import { spawn } from 'node:child_process';

// Unattended, non-interactive run: `-p` (print mode) makes Claude Code do one
// turn and exit instead of opening its REPL, and
// `--dangerously-skip-permissions` is required for that turn to actually
// edit files/run tools with nobody at the keyboard to approve them.
//
// That flag is exactly as dangerous as it sounds outside a throwaway
// sandbox: agent-runner MUST run each task in an isolated environment (a
// container/VM with no access to real secrets, per ROADMAP.md section
// 3 point 6) — the git-worktree isolation this module runs inside handles
// disk state, but nothing here sandboxes network or process access. Do not
// point this at a shared server user account.
export const DEFAULT_AGENT_TIMEOUT_SEC = 30 * 60;
const OUTPUT_TAIL_BYTES = 64 * 1024;

function defaultTimeoutMs(): number {
  const sec = Number(process.env.SYNC_AGENT_TIMEOUT_SEC);
  return (Number.isFinite(sec) && sec > 0 ? sec : DEFAULT_AGENT_TIMEOUT_SEC) * 1000;
}

// A hung CLI would otherwise block `--watch` forever, so the run has a
// deadline: SIGTERM, then SIGKILL after `killGraceMs`, then a rejection.
// `output` keeps only the last 64 KB of stdout (everything is still streamed).
export function runClaude(
  cwd: string,
  prompt: string,
  model?: string,
  timeoutMs: number = defaultTimeoutMs(),
  killGraceMs = 10_000,
): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '--dangerously-skip-permissions'];
    if (model) args.push('--model', model);

    const child = spawn('claude', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf-8');
      if (output.length > OUTPUT_TAIL_BYTES) output = output.slice(-OUTPUT_TAIL_BYTES);
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
    });

    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), killGraceMs);
    }, timeoutMs);
    const clearTimers = () => {
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
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
      if (timedOut) {
        reject(new Error(`claude timed out after ${Math.round(timeoutMs / 1000)}s and was killed`));
        return;
      }
      resolve({ exitCode: code ?? 1, output });
    });
  });
}

export function buildIssuePrompt(title: string, description: string): string {
  return [
    `Task (GitLab issue): ${title}`,
    '',
    description,
    '',
    'Implement this. The repository in the current working directory is a dedicated ' +
      'git worktree checked out for this task only — make whatever changes are needed ' +
      'directly in it.',
  ].join('\n');
}
