import { githubDispatcher } from '../common/github-dispatcher';
import { ConfigService } from '@nestjs/config';

import { GithubApiService } from '../loop/github-api.service';
import { LabProject } from './entities/lab-project.entity';

const API = 'https://api.github.com';
const TIMEOUT_MS = 20_000;
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function isValidRepo(repo: string): boolean {
  return REPO_PATTERN.test(repo) && !repo.includes('..');
}

const BRANCH_PATTERN = /^[\w./-]{1,100}$/;

// What `git check-ref-format` rejects, within the characters Lab accepts: `..`, a leading/trailing `/`, `//`,
// a segment starting with `.`, a trailing `.lock` or `.`.
export function isValidBranch(name: string): boolean {
  return (
    typeof name === 'string' &&
    BRANCH_PATTERN.test(name) &&
    !name.includes('..') &&
    !name.includes('//') &&
    !name.startsWith('/') &&
    !name.endsWith('/') &&
    !name.endsWith('.') &&
    !name
      .split('/')
      .some((part) => part.startsWith('.') || part.endsWith('.lock'))
  );
}

// GitHub answers a token that lacks a permission with one line that does not say WHICH — name them.
const TOKEN_PERMISSION_ERROR =
  'Resource not accessible by personal access token';

export function describeGithubError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);

  return text.includes(TOKEN_PERMISSION_ERROR) || /GitHub 40[34]/.test(text)
    ? `${text}. Токену GitHub для Lab нужны права на этот репозиторий: Contents — чтение и запись, Pull requests — чтение и запись (Metadata — чтение)`
    : text;
}

// The existing GitHub client of the loop reads its repository and token from configuration, one pair for the whole installation.
// A Lab project brings its own pair: the same class, over a configuration that answers with the project's values. The client in
// src/loop is not touched.
export function githubFor(
  project: Pick<LabProject, 'repo' | 'token' | 'baseBranch'>,
): GithubApiService {
  const values: Record<string, string> = {
    GITHUB_REPO: project.repo,
    LOOP_GITHUB_TOKEN: project.token,
    GITHUB_BASE_BRANCH: project.baseBranch,
  };

  return new GithubApiService({
    get: (key: string) => values[key],
  } as unknown as ConfigService);
}

export interface RepoCheck {
  canRead: boolean;
  // The base branch exists in the repository (also false when the repository could not be read).
  branchFound: boolean;
  canWrite: boolean;
  defaultBranch: string | null;
  isPrivate: boolean | null;
  // When the token expires (GitHub's github-authentication-token-expiration header); null for a token without expiry.
  tokenExpiresAt: Date | null;
  // What the owner has to fix, in words.
  problems: string[];
}

// '2026-11-30 12:00:00 UTC' -> Date; null when absent or unparseable.
export function parseTokenExpiry(header: string | null): Date | null {
  const match = header
    ?.trim()
    .match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\s*(?:UTC|Z))?$/);

  if (!match) return null;

  const date = new Date(`${match[1]}T${match[2]}Z`);

  return Number.isNaN(date.getTime()) ? null : date;
}

async function repoRequest(
  repo: string,
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${API}/repos/${repo}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    dispatcher: githubDispatcher(),
  } as RequestInit);
}

export interface RepoIssue {
  number: number;
  title: string;
  body: string;
  htmlUrl: string;
}

// The task limit of StartLabRunDto: a longer issue body is cut so the prefilled task still starts.
export const ISSUE_BODY_MAX = 8000;

// Open issues of the repository, newest activity first; pull requests (GitHub lists them as issues too) are dropped.
export async function listOpenIssues(
  repo: string,
  token: string,
  limit = 30,
): Promise<RepoIssue[]> {
  let response: Response;

  try {
    response = await repoRequest(
      repo,
      token,
      `/issues?state=open&sort=updated&per_page=${limit}`,
    );
  } catch (error) {
    throw new Error(
      `GitHub недоступен: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (response.status === 403 || response.status === 404)
    throw new Error('Токен не может читать issues');
  if (!response.ok)
    throw new Error(`GitHub вернул ${response.status} при чтении issues`);

  const items = (await response.json()) as Array<{
    number: number;
    title?: string;
    body?: string | null;
    html_url?: string;
    pull_request?: unknown;
  }>;

  return items
    .filter((item) => !item.pull_request)
    .map((item) => ({
      number: item.number,
      title: item.title ?? '',
      body: (item.body ?? '').slice(0, ISSUE_BODY_MAX),
      htmlUrl: item.html_url ?? '',
    }));
}

// Can this token read the repository, find the base branch there, and write?
export async function checkRepo(
  repo: string,
  token: string,
  baseBranch: string,
): Promise<RepoCheck> {
  const result: RepoCheck = {
    canRead: false,
    branchFound: false,
    canWrite: false,
    defaultBranch: null,
    isPrivate: null,
    tokenExpiresAt: null,
    problems: [],
  };

  if (!isValidBranch(baseBranch)) {
    result.problems.push('Недопустимое имя ветки');

    return result;
  }

  let info: Response;

  try {
    info = await repoRequest(repo, token, '');
  } catch (error) {
    result.problems.push(
      `GitHub недоступен: ${error instanceof Error ? error.message : String(error)}`,
    );

    return result;
  }

  if (info.status === 401) {
    result.problems.push('GitHub не принял токен (401): он неверный или истёк');

    return result;
  }
  if (info.status === 404) {
    result.problems.push(
      `Репозиторий ${repo} не найден — проверьте имя; для приватного токен должен иметь к нему доступ`,
    );

    return result;
  }
  if (!info.ok) {
    result.problems.push(`GitHub вернул ${info.status} при чтении репозитория`);

    return result;
  }

  result.tokenExpiresAt = parseTokenExpiry(
    info.headers.get('github-authentication-token-expiration'),
  );

  const data = (await info.json()) as {
    default_branch?: string;
    private?: boolean;
    permissions?: { push?: boolean };
  };

  result.canRead = true;
  result.defaultBranch = data.default_branch ?? null;
  result.isPrivate = data.private ?? null;

  const branch = await repoRequest(
    repo,
    token,
    `/git/ref/heads/${baseBranch.split('/').map(encodeURIComponent).join('/')}`,
  ).catch(() => null);

  result.branchFound = Boolean(branch?.ok);

  if (!result.branchFound) {
    result.problems.push(
      branch?.status === 409
        ? 'Репозиторий пуст — сделайте в нём первый коммит (например, README), Lab работает с существующей веткой'
        : `Ветка «${baseBranch}» не найдена${result.defaultBranch ? ` (ветка по умолчанию — «${result.defaultBranch}»)` : ''}`,
    );
  }

  // GitHub tells a token what it may do in the repository itself (`permissions.push` is Contents: write) — that is the answer, no
  // request that changes anything is needed. Only when the field is missing, the write is tried with a harmless blob nothing points at.
  if (data.permissions?.push !== undefined) {
    result.canWrite = data.permissions.push;
  } else {
    const probe = await repoRequest(repo, token, '/git/blobs', {
      method: 'POST',
      body: JSON.stringify({ content: 'lab', encoding: 'utf-8' }),
    }).catch(() => null);

    result.canWrite = Boolean(probe?.ok);
  }

  if (!result.canWrite) {
    result.problems.push(
      'Токен читает репозиторий, но не может писать: нужны права Contents — «Read and write» и Pull requests — «Read and write»',
    );
  }

  return result;
}

const TRANSIENT =
  /aborted due to timeout|timed out|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|GitHub 5\d\d/i;

// A read from GitHub that failed for a reason of the network, not of the request (a timeout, a reset connection, a 5xx), is tried once
// more, and whatever still fails says WHICH step it was — "operation was aborted due to timeout" alone does not. Only for reads: a write
// that timed out may have gone through.
export async function readStep<T>(
  label: string,
  run: () => Promise<T>,
  pauseMs = 2000,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);

      if (attempt === 1 && TRANSIENT.test(text)) {
        await new Promise((resolve) => setTimeout(resolve, pauseMs));
        continue;
      }

      throw new Error(`${label}: ${text}`);
    }
  }
}

const ZIP_IDLE_MS = 30_000;
export const ZIP_TOTAL_MS = 10 * 60_000;
export const ZIP_MAX_BYTES = 100 * 1024 * 1024;

// The repository at a commit as a zip. The client of the loop gives the whole download 90 s, which a bigger repository (images, other
// binaries — the archive carries everything, though only text goes to the worker) or a slow link does not make; here the download may take
// as long as bytes keep arriving, and a stall, or a repository over the limit, says how far it got.
export async function downloadRepoZip(
  repo: string,
  token: string,
  sha: string,
  idleMs = ZIP_IDLE_MS,
): Promise<Uint8Array> {
  const abort = new AbortController();
  const startedAt = Date.now();
  const total = setTimeout(() => abort.abort(), ZIP_TOTAL_MS);
  let idle: NodeJS.Timeout | undefined;
  let received = 0;
  const progress = () =>
    `получено ${(received / 1024 / 1024).toFixed(1)} МБ за ${Math.round((Date.now() - startedAt) / 1000)} с`;
  const arm = () => {
    clearTimeout(idle);
    idle = setTimeout(() => abort.abort(), idleMs);
  };

  try {
    arm();

    const response = await fetch(`${API}/repos/${repo}/zipball/${sha}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${token}`,
      },
      signal: abort.signal,
      dispatcher: githubDispatcher(),
    } as RequestInit);

    if (!response.ok || !response.body)
      throw new Error(`GitHub ${response.status} при скачивании архива`);

    const chunks: Uint8Array[] = [];
    const reader = response.body.getReader();
    const stalled = new Promise<never>((_resolve, reject) => {
      abort.signal.addEventListener(
        'abort',
        () => reject(new Error('aborted')),
        { once: true },
      );
    });

    stalled.catch(() => undefined);

    for (;;) {
      // Not left to fetch alone to end a read that never returns: the abort itself ends the wait.
      const { done, value } = await Promise.race([reader.read(), stalled]);

      if (done) break;

      arm();
      received += value.length;

      if (received > ZIP_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error(
          `репозиторий больше ${ZIP_MAX_BYTES / 1024 / 1024} МБ — Lab такие не берёт (уберите из него крупные файлы или выберите другой проект)`,
        );
      }

      chunks.push(value);
    }

    // One copy of the archive, not three (the chunks, their concatenation, and a Uint8Array made from it).
    const all = Buffer.concat(chunks, received);

    chunks.length = 0;

    return new Uint8Array(all.buffer, all.byteOffset, all.byteLength);
  } catch (error) {
    if (abort.signal.aborted)
      throw new Error(
        `не пришло данных ${Math.round(idleMs / 1000)} с или архив качается дольше ${ZIP_TOTAL_MS / 60000} мин (${progress()})`,
      );

    throw error;
  } finally {
    clearTimeout(idle);
    clearTimeout(total);
  }
}
