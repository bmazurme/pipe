import { describeFetchError } from '../utils/describe-fetch-error';

const API = 'https://api.github.com';
const TIMEOUT_MS = 30_000;
export const DEFAULT_GITHUB_LABEL = 'loop';

export type GithubIssue = {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
};

// The token comes from the environment, not Settings: reports' settings.json
// is exported/imported as a bundle, and a GitHub credential has no business
// travelling in it. A fine-grained token limited to the task repo with
// "Issues: read & write" is all this needs.
function token(): string {
  const value = process.env.GITHUB_TOKEN;

  if (!value) {
    throw new Error('Интеграция с GitHub не настроена: задайте GITHUB_TOKEN в packages/server/.env (достаточно прав Issues: read & write)');
  }

  return value;
}

async function githubFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = `${API}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...init.headers,
      Authorization: `Bearer ${token()}`,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((error) => {
    throw describeFetchError(error, url);
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;

    throw new Error(`GitHub API вернул ошибку ${response.status}${body?.message ? `: ${body.message}` : ''}`);
  }

  return response;
}

export async function getRepo(githubRepo: string): Promise<{ id: number; fullName: string }> {
  const repo = (await (await githubFetch(`/repos/${githubRepo}`)).json()) as { id: number; full_name: string };

  return { id: repo.id, fullName: repo.full_name };
}

// Open issues only, newest first. The issues endpoint also returns pull
// requests (they are issues to GitHub) — filtered out, a PR is never a task.
export async function listIssues(githubRepo: string, label = DEFAULT_GITHUB_LABEL): Promise<GithubIssue[]> {
  const query = new URLSearchParams({ state: 'open', labels: label, per_page: '50', sort: 'created', direction: 'desc' });
  const items = (await (await githubFetch(`/repos/${githubRepo}/issues?${query}`)).json()) as Array<GithubIssue & { pull_request?: unknown }>;

  return items.filter((item) => !item.pull_request);
}

export async function getIssue(githubRepo: string, number: number | string): Promise<GithubIssue> {
  return (await (await githubFetch(`/repos/${githubRepo}/issues/${number}`)).json()) as GithubIssue;
}

export async function addComment(githubRepo: string, number: number | string, body: string): Promise<void> {
  await githubFetch(`/repos/${githubRepo}/issues/${number}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
}

let cachedLogin: string | undefined;

export async function getLogin(): Promise<string> {
  if (!cachedLogin) {
    cachedLogin = ((await (await githubFetch('/user')).json()) as { login: string }).login;
  }

  return cachedLogin;
}
