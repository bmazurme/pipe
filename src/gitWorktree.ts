import { execFileSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

// execFileSync's default maxBuffer is 1 MB (combined stdout+stderr) — a
// `push`/`commit` that touches many files (e.g. an agent running `npm
// install` in the worktree, with the target repo missing a node_modules
// entry in .gitignore) can produce far more progress/status text than that
// and throws ENOBUFS. 200 MB matches bridge's own upload size limit — if a
// git operation produces more text than that, something is already very
// wrong and should fail loudly rather than being papered over further.
const MAX_BUFFER = 200 * 1024 * 1024;

// stdio: 'pipe' for stderr too (execFileSync's own default inherits stderr
// straight to the parent's terminal) — a caught, expected failure (e.g.
// branchExists()'s probe) would otherwise print git's raw "fatal: ..." line
// even though nothing is actually wrong. Nothing is lost: on a real failure
// the same text is already embedded in the thrown error's .message.
function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    maxBuffer: MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// Directory names that must never be committed regardless of whether the
// target repo's own .gitignore happens to list them — an agent run can
// freely `npm install`/build inside the worktree, and a missing .gitignore
// entry there must not turn into node_modules landing in real GitHub
// history. Physically deleted before `git add -A` rather than excluded via
// a git pathspec: git's default (non-glob) pathspec matching does not
// reliably cross directory separators for a bare `**` pattern, so a
// pathspec exclude can silently miss a nested `packages/*/node_modules`.
const BUILD_ARTIFACT_DIR_NAMES = new Set(['node_modules', 'dist', 'build', 'coverage']);

// Plain recursive walk rather than a glob library: stops descending the
// moment it finds a match (no point walking into a node_modules tree just
// to find nested node_modules inside it — the parent rmSync takes those
// too) and explicitly skips `.git`, which must never be touched.
function findArtifactDirs(dir: string, found: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '.git') continue;

    const full = path.join(dir, entry.name);
    if (BUILD_ARTIFACT_DIR_NAMES.has(entry.name)) {
      found.push(full);
      continue;
    }

    findArtifactDirs(full, found);
  }

  return found;
}

function stripBuildArtifacts(worktreeDir: string): void {
  for (const dir of findArtifactDirs(worktreeDir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

function branchExists(repoPath: string, branch: string): boolean {
  try {
    git(repoPath, ['show-ref', '--verify', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

// Runs the task in a dedicated `git worktree` next to the tracked repo,
// never in project.path itself — agent-runner has no human watching it, so
// it must not fight the user's own checkout for a branch or clobber
// uncommitted work if it runs while someone happens to be using the same
// repo (see docs/roadmap.md section 4, "Создание ветки: git worktree").
export function addTaskWorktree(
  repoPath: string,
  worktreeDir: string,
  branch: string,
  baseBranch: string,
): void {
  if (branchExists(repoPath, branch)) {
    git(repoPath, ['worktree', 'add', worktreeDir, branch]);
    return;
  }

  try {
    git(repoPath, ['fetch', '--quiet', 'origin', baseBranch]);
    git(repoPath, ['worktree', 'add', worktreeDir, '-b', branch, `origin/${baseBranch}`]);
  } catch {
    // No network / no such branch on origin (e.g. a fresh local-only repo) —
    // fall back to branching off whatever HEAD already points to locally.
    git(repoPath, ['worktree', 'add', worktreeDir, '-b', branch, 'HEAD']);
  }
}

// Silently a no-op (not an error) when worktreeDir was never registered —
// e.g. the very first run for an issue, before any worktree has existed yet.
export function removeTaskWorktree(repoPath: string, worktreeDir: string): void {
  try {
    git(repoPath, ['worktree', 'remove', worktreeDir, '--force']);
  } catch {
    // Expected on a fresh issue / already-removed worktree; nothing to warn about.
  }
}

// --allow-empty: Claude may leave the tree byte-identical to "before" (e.g.
// it decided no change was needed) — that must still land as a real "after"
// commit for the branch to have two commits to diff, not silently no-op.
export function commitAll(worktreeDir: string, message: string): string {
  stripBuildArtifacts(worktreeDir);
  git(worktreeDir, ['add', '-A']);
  git(worktreeDir, ['commit', '-m', message, '--allow-empty']);
  return git(worktreeDir, ['rev-parse', 'HEAD']).trim();
}

export function pushBranch(worktreeDir: string, branch: string): void {
  git(worktreeDir, ['push', '--quiet', '-u', 'origin', branch]);
}
