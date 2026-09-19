import { spawn } from 'node:child_process';

// Unattended, non-interactive run: `-p` (print mode) makes Claude Code do one
// turn and exit instead of opening its REPL, and
// `--dangerously-skip-permissions` is required for that turn to actually
// edit files/run tools with nobody at the keyboard to approve them.
//
// That flag is exactly as dangerous as it sounds outside a throwaway
// sandbox: agent-runner MUST run each task in an isolated environment (a
// container/VM with no access to real secrets, per docs/roadmap.md section
// 3 point 6) — the git-worktree isolation this module runs inside handles
// disk state, but nothing here sandboxes network or process access. Do not
// point this at a shared server user account.
export function runClaude(cwd: string, prompt: string, model?: string): Promise<{ exitCode: number; output: string }> {
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
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
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
