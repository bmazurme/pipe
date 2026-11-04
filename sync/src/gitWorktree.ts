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

// Directory names that must never be *committed* — an agent run can freely
// `npm install`/build inside the worktree, and a missing .gitignore entry
// there must not turn into node_modules landing in real GitHub history.
// Only stripped when the target repo's own .gitignore doesn't already keep
// them out of git (see isGitIgnored) — a repo that *does* gitignore
// node_modules properly (the common case) needs it left alone, since a
// pre-commit hook (husky, lint-staged, etc.) commonly reads
// node_modules/.bin for its own tools; deleting it unconditionally right
// before `git commit` broke exactly that (a real incident: husky's
// pre-commit hook failed with "oxlint: command not found" because this
// stripped node_modules moments before the hook ran, in a repo whose
// .gitignore already excluded it — the strip was never needed there).
const BUILD_ARTIFACT_DIR_NAMES = new Set(['node_modules', 'dist', 'build', 'coverage']);

function isGitIgnored(repoRoot: string, absolutePath: string): boolean {
  try {
    // Exit 0 = ignored (the only case that doesn't throw).
    execFileSync('git', ['check-ignore', '-q', absolutePath], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
    return true;
  } catch {
    // Exit 1 = not ignored (the real "no" answer) — and any other nonzero
    // (a git usage error, say) is treated the same way, erring toward
    // stripping the directory, which is the behavior every caller already
    // had before this check existed.
    return false;
  }
}

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
    if (!isGitIgnored(worktreeDir, dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

// The branch name comes from the parcel's manifest, which is untrusted
// (anyone who can drop a parcel into the bridge account sets it). Checked
// before any worktree work: a parcel naming `main` or the project's base
// branch would otherwise get the parcel files and Claude's changes pushed
// straight there, skipping review, and a leading `-` would be read by git as
// an option. Throws with the reason; same rules as bridge Lab's
// isValidBranch (lab-github.ts), plus the protected names.
const PROTECTED_BRANCHES = new Set(['HEAD', 'main', 'master']);

export function assertSafeTaskBranch(branch: string, baseBranch: string): void {
  const refuse = (reason: string): never => {
    throw new Error(`refusing branch ${JSON.stringify(branch)}: ${reason}`);
  };

  if (typeof branch !== 'string' || branch.length === 0) refuse('empty name');
  if (branch.startsWith('-')) refuse('starts with "-"');
  if (/[\s\x00-\x1f\x7f]/.test(branch)) refuse('contains whitespace or a control character');
  if (/[~^:?*[\\]/.test(branch)) refuse('contains a character git does not allow in a ref name');
  if (branch.includes('..')) refuse('contains ".."');
  if (branch.includes('//')) refuse('contains "//"');
  if (branch.includes('@{')) refuse('contains "@{"');
  if (branch.startsWith('/') || branch.endsWith('/') || branch.endsWith('.')) {
    refuse('starts or ends with "/", or ends with "."');
  }
  if (branch.split('/').some((part) => part.startsWith('.') || part.endsWith('.lock'))) {
    refuse('a path segment starts with "." or ends with ".lock"');
  }
  if (branch.startsWith('refs/')) refuse('starts with "refs/"');
  if (PROTECTED_BRANCHES.has(branch) || branch === baseBranch) refuse('is the base branch or a protected branch');
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
// repo (see ROADMAP.md section 4, "Создание ветки: git worktree").
export function addTaskWorktree(
  repoPath: string,
  worktreeDir: string,
  branch: string,
  baseBranch: string,
): void {
  if (branchExists(repoPath, branch)) {
    git(repoPath, ['worktree', 'add', '--', worktreeDir, branch]);
    return;
  }

  try {
    git(repoPath, ['fetch', '--quiet', 'origin', baseBranch]);
    git(repoPath, ['worktree', 'add', '-b', branch, '--', worktreeDir, `origin/${baseBranch}`]);
  } catch {
    // No network / no such branch on origin (e.g. a fresh local-only repo) —
    // fall back to branching off whatever HEAD already points to locally.
    git(repoPath, ['worktree', 'add', '-b', branch, '--', worktreeDir, 'HEAD']);
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
  git(worktreeDir, ['push', '--quiet', '-u', '--', 'origin', branch]);
}
