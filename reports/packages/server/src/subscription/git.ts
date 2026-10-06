import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });

  return stdout;
}

export async function isTreeClean(path: string): Promise<boolean> {
  const output = await git(path, ['status', '--porcelain']);

  return output.trim().length === 0;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${day}.${month}.${year}`;
}

/** Git branch names can't contain spaces, `..`, `~^:?*[\`, `@{`, or start/end with `.`/`.lock`. */
function sanitizeUsername(username: string): string {
  return username.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'user';
}

/** Mask: `${username}-${DD.MM.YYYY}-${iid}`, e.g. `mazur-15.09.2026-123`. */
export function buildBranchName(username: string, iid: string | number, date = new Date()): string {
  return `${sanitizeUsername(username)}-${formatDate(date)}-${iid}`;
}

export async function branchExists(path: string, branch: string): Promise<boolean> {
  try {
    await git(path, ['show-ref', '--verify', `refs/heads/${branch}`]);

    return true;
  } catch {
    return false;
  }
}

export async function createBranch(path: string, branch: string, baseBranch = 'main'): Promise<void> {
  if (!(await isTreeClean(path))) {
    throw new Error(`В репозитории ${path} есть незакоммиченные изменения — закоммитьте или сохраните их перед init`);
  }

  if (await branchExists(path, branch)) {
    await git(path, ['checkout', branch]);

    return;
  }

  try {
    await git(path, ['fetch', 'origin', baseBranch]);
  } catch (error) {
    throw new Error(
      `Не удалось получить ветку "${baseBranch}" из origin — убедитесь, что она существует в удалённом ` +
        `репозитории (если репозиторий пуст, сделайте и запушьте первый коммит) или укажите правильную ` +
        `базовую ветку в Settings → Отслеживаемые репозитории. (${(error as Error).message})`,
    );
  }

  await git(path, ['checkout', '-b', branch, `origin/${baseBranch}`]);
}

// Guards against committing onto whatever branch happens to be checked out.
// `init` leaves the repo on the task branch, but nothing stops it drifting
// away between init and pull — switching branches for other work in the
// meantime, say. Without this, pull's commit lands on HEAD wherever HEAD
// happens to be (the target/base branch, another task's branch, ...), and a
// later ordinary `git push` from there would carry it along. Refuses on a
// dirty tree for the same reason createBranch does: switching branches with
// uncommitted changes present would carry them along onto the task branch.
export async function checkoutTaskBranch(path: string, branch: string): Promise<void> {
  if (!(await isTreeClean(path))) {
    throw new Error(`В репозитории ${path} есть незакоммиченные изменения — закоммитьте или сохраните их перед pull`);
  }

  await git(path, ['checkout', branch]);

  // The task branch can have moved on origin since this clone last saw it —
  // sync-cli's agent-runner pushes its own "before"/"after" commits to the
  // same branch from an entirely different clone/worktree, so this repo's
  // local ref is routinely behind by the time pull runs (in fact on every
  // *first* pull after agent-runner has already run once, since `init`
  // only ever branches off origin/baseBranch, never fetches the task
  // branch itself). Without catching up, commitPulledFiles' commit lands as
  // a sibling rather than a descendant of what's already on origin, and the
  // plain `git push` in pushBranch below is rejected as non-fast-forward —
  // after the pulled files were already written and committed locally, so
  // it looks like "the data landed but the step never completes".
  //
  // A missing remote branch (nobody has pushed to it since init, or there's
  // no "origin" configured at all) isn't an error — there's simply nothing
  // to catch up on yet, so this silently proceeds exactly as before.
  try {
    await git(path, ['fetch', 'origin', branch]);
  } catch {
    return;
  }

  try {
    await git(path, ['merge', '--ff-only', `origin/${branch}`]);
  } catch (error) {
    throw new Error(
      `Ветка ${branch} разошлась с origin — её нужно синхронизировать вручную перед pull. (${(error as Error).message})`,
    );
  }
}

// Stages exactly the files the pull just wrote — never `git add -A`. Unlike
// sync's agent-runner, this runs against the developer's own regular
// checkout, not a freshly-created isolated worktree, so a blanket add could
// sweep up unrelated work already sitting there uncommitted.
// --allow-empty: a parcel can legitimately carry only an image asset and no
// file changes (or, in principle, none of either) — still worth a real
// commit marking that the pull happened, not a silent no-op.
export async function commitPulledFiles(path: string, relPaths: string[], message: string): Promise<void> {
  if (relPaths.length > 0) {
    await git(path, ['add', '--', ...relPaths]);
  }

  await git(path, ['commit', '-m', message, '--allow-empty']);
}

// Pushes the task branch only — never the target/base branch. Getting the
// result into the target branch is a deliberate manual step (open a merge
// request yourself) — nothing here does that automatically.
export async function pushBranch(path: string, branch: string): Promise<void> {
  await git(path, ['push', '-u', 'origin', branch]);
}

// Reads one file as it is on a branch without checking the branch out — the
// working tree (often the developer's own, possibly on another branch) is
// never touched. Null when the branch or the file doesn't exist.
export async function showFile(path: string, ref: string, file: string): Promise<string | null> {
  try {
    return await git(path, ['show', `${ref}:${file}`]);
  } catch {
    return null;
  }
}

