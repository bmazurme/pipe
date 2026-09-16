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

  await git(path, ['fetch', 'origin', baseBranch]);
  await git(path, ['checkout', '-b', branch, `origin/${baseBranch}`]);
}
