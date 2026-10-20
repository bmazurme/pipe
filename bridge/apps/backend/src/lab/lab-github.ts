import { ConfigService } from '@nestjs/config';

import { GithubApiService } from '../loop/github-api.service';
import { LabProject } from './entities/lab-project.entity';

const API = 'https://api.github.com';
const TIMEOUT_MS = 20_000;
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function isValidRepo(repo: string): boolean {
  return REPO_PATTERN.test(repo) && !repo.includes('..');
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
  canWrite: boolean;
  defaultBranch: string | null;
  isPrivate: boolean | null;
  // What the owner has to fix, in words.
  problems: string[];
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
  });
}

// Can this token read the repository, find the base branch there, and write?
export async function checkRepo(
  repo: string,
  token: string,
  baseBranch: string,
): Promise<RepoCheck> {
  const result: RepoCheck = {
    canRead: false,
    canWrite: false,
    defaultBranch: null,
    isPrivate: null,
    problems: [],
  };

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

  if (!branch?.ok) {
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
