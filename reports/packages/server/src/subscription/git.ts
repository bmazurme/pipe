import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const NETWORK_TIMEOUT_MS = 120_000;
const LOCAL_TIMEOUT_MS = 30_000;

// Never let git wait for a credential prompt or a silent remote: a hung fetch/push would hang the HTTP request or the autopilot tick forever.
export async function runGit(cwd: string, args: string[], input?: string, timeoutMs?: number): Promise<string> {
  const timeout = timeoutMs ?? (args.some((arg) => arg === 'fetch' || arg === 'push') ? NETWORK_TIMEOUT_MS : LOCAL_TIMEOUT_MS);
  const pending = execFileAsync('git', args, {
    cwd,
    timeout,
    killSignal: 'SIGKILL',
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
  });
  if (input !== undefined) pending.child.stdin?.end(input);
  try {
    const { stdout } = await pending;

    return stdout;
  } catch (error) {
    if ((error as { killed?: boolean }).killed) {
      const command = args.find((arg, i) => !arg.startsWith('-') && args[i - 1] !== '-c' && !arg.includes('=')) ?? 'git';
      throw new Error(`git ${command} не ответил за ${Math.round(timeout / 1000)} с — проверьте доступ к origin`);
    }
    throw error;
  }
}

// `input` goes to git's stdin — for anything that can be long (a list of paths), since the command line of a spawned process
// is capped (about 32 000 characters on Windows, ENAMETOOLONG beyond it) and stdin is not.
function git(cwd: string, args: string[], input?: string): Promise<string> {
  return runGit(cwd, args, input);
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

export async function currentBranch(path: string): Promise<string> {
  return (await git(path, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
}

// Puts every uncommitted change (untracked files included) aside in the stash instead of deleting it, so nothing is lost: it can be
// brought back with `git stash pop`. Returns whether there was anything to put aside.
export async function stashChanges(path: string, message: string): Promise<boolean> {
  if (await isTreeClean(path)) return false;

  await git(path, ['stash', 'push', '--include-untracked', '-m', message]);

  return true;
}

export async function branchExists(path: string, branch: string): Promise<boolean> {
  try {
    await git(path, ['show-ref', '--verify', `refs/heads/${branch}`]);

    return true;
  } catch {
    return false;
  }
}

// Branches a task must never be written to or published as: the target branch of the task's project, and the usual
// mainlines. Everything this module commits or pushes goes to the task's own branch, named by the mask above.
export function assertTaskBranch(branch: string, baseBranch = 'main'): void {
  const protectedBranches = new Set(['main', 'master', 'HEAD', baseBranch]);

  if (!branch.trim() || protectedBranches.has(branch)) {
    throw new Error(
      `Ветка "${branch}" — целевая: reports работает только с именной веткой задачи (по маске логин-дата-номер) ` +
        'и никогда не пишет и не публикует в main/master или базовую ветку проекта.',
    );
  }
}

export async function createBranch(path: string, branch: string, baseBranch = 'main'): Promise<void> {
  assertTaskBranch(branch, baseBranch);

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

  // --no-track: the branch starts from origin/<base> but must not follow it — with that upstream a bare `git push` (or
  // `push.default=upstream`) would send the task's commits to the target branch.
  await git(path, ['checkout', '-b', branch, '--no-track', `origin/${baseBranch}`]);
}

// Guards against committing onto whatever branch happens to be checked out.
// `init` leaves the repo on the task branch, but nothing stops it drifting
// away between init and pull — switching branches for other work in the
// meantime, say. Without this, pull's commit lands on HEAD wherever HEAD
// happens to be (the target/base branch, another task's branch, ...), and a
// later ordinary `git push` from there would carry it along. Refuses on a
// dirty tree for the same reason createBranch does: switching branches with
// uncommitted changes present would carry them along onto the task branch.
export async function checkoutTaskBranch(path: string, branch: string, baseBranch = 'main'): Promise<void> {
  assertTaskBranch(branch, baseBranch);

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

// Of the given paths, those a .gitignore excludes and git does not already track. `check-ignore` exits 1 when none match.
async function ignoredPaths(path: string, relPaths: string[]): Promise<string[]> {
  if (relPaths.length === 0) return [];

  try {
    const output = await git(path, ['check-ignore', '-z', '--stdin'], relPaths.join('\0'));

    return output.split('\0').filter(Boolean);
  } catch (error) {
    if ((error as { code?: number }).code === 1) return [];
    throw error;
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
  // The result carries the whole tracked tree, including files this checkout's own .gitignore excludes — `git add` refuses
  // the whole batch over one of them. They stay on disk, just out of the commit (a file already tracked is never "ignored").
  const ignored = new Set(await ignoredPaths(path, relPaths));
  const stageable = relPaths.filter((relPath) => !ignored.has(relPath));

  if (stageable.length > 0) {
    // Thousands of paths do not fit on a Windows command line, so they are read from stdin (NUL-separated), and taken
    // literally — a name such as `[id].vue` is not a glob.
    await git(path, ['--literal-pathspecs', 'add', '--pathspec-from-file=-', '--pathspec-file-nul'], stageable.join('\0'));
  }

  await git(path, ['commit', '-m', message, '--allow-empty']);
}

// Pushes the task branch only — never the target/base branch. Getting the
// result into the target branch is a deliberate manual step (open a merge
// request yourself) — nothing here does that automatically.
export async function pushBranch(path: string, branch: string, baseBranch = 'main'): Promise<void> {
  assertTaskBranch(branch, baseBranch);

  // An explicit refs/heads/<branch>:refs/heads/<branch> — whatever upstream or push.default the repo has, this sends the
  // task branch to the branch of the same name and nothing else.
  await git(path, ['push', '-u', 'origin', `refs/heads/${branch}:refs/heads/${branch}`]);
}

// Reads one file as it is on a branch without checking the branch out — the
// working tree (often the developer's own, possibly on another branch) is
// never touched. Null when the branch or the file doesn't exist.
// Directories a person might want to scope an analysis to: up to two levels
// deep, from the committed tree (so build output and node_modules never show).
export async function listModules(path: string): Promise<string[]> {
  const output = await git(path, ['ls-tree', '-r', '-d', '--name-only', 'HEAD']);

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((dir) => dir && dir.split('/').length <= 2 && !dir.split('/').some((part) => part.startsWith('.')))
    .sort();
}

export async function showFile(path: string, ref: string, file: string): Promise<string | null> {
  try {
    return await git(path, ['show', `${ref}:${file}`]);
  } catch {
    return null;
  }
}

// Files the task branch changes relative to its base — what a PR would show.
// Three-dot: changes on the branch since it forked, not the base's own
// progress. Prefers origin/<base> (init fetched it) over a possibly stale
// local copy.
export async function changedFiles(path: string, base: string, branch: string): Promise<string[]> {
  const baseRef = (await git(path, ['rev-parse', '--verify', '--quiet', `origin/${base}`]).then(
    () => `origin/${base}`,
    () => base,
  ));
  const output = await git(path, ['diff', '--name-only', '--no-renames', `${baseRef}...${branch}`]);

  return output.split('\n').filter(Boolean);
}

