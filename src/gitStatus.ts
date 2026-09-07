import { execFileSync } from 'node:child_process';

export function isGitTreeClean(projectPath: string): boolean {
  try {
    const output = execFileSync('git', ['status', '--porcelain'], {
      cwd: projectPath,
      encoding: 'utf-8',
    });
    return output.trim().length === 0;
  } catch {
    // Not a git repo (or git missing) — nothing to protect, treat as clean.
    return true;
  }
}
