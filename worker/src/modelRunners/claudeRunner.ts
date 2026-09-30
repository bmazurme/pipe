import { spawn } from 'node:child_process';

export interface RunResult {
  exitCode: number;
  output: string;
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
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '--dangerously-skip-permissions', '--model', claudeModel];
    const child = spawn('claude', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      output += text;
      onOutput(text);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      onOutput(chunk.toString('utf-8'));
    });

    child.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error('"claude" binary not found on PATH — install Claude Code on this server first.'));
        return;
      }
      reject(error);
    });

    child.on('close', (code) => {
      resolve({ exitCode: code ?? 1, output });
    });
  });
}
