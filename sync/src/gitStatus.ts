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

// Issue-mode only — the branch name is recorded in the subscription manifest
// so the receiving side knows which branch a parcel's result belongs to.
export function getCurrentBranch(projectPath: string): string {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: projectPath,
      encoding: 'utf-8',
    }).trim();
  } catch (error) {
    throw new Error(
      `Could not determine the current git branch for ${projectPath}: ${(error as Error).message}`,
    );
  }
}
