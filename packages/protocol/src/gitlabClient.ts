// Shared GitLab REST plumbing for sync's and reports' own GitLab clients
// (IMPROVEMENTS_TECH.md 2.1) — the actual duplicated code between them was
// the authenticated-fetch-with-timeout-and-error-throw boilerplate, not
// their business logic: sync takes apiUrl/token as explicit params (no
// config of its own beyond sync.config.json/.sync-credentials.json),
// reports reads a global settings singleton and localizes its error
// messages into Russian for its UI. Both keep their own thin wrapper file
// (sync/src/gitlabClient.ts, reports/.../subscription/gitlab-client.ts)
// built on top of what's here, rather than importing this directly, so
// neither has to give up its own config source or error-message language.
const DEFAULT_TIMEOUT_MS = 30_000;

export class GitlabApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body: string,
  ) {
    super(`GitLab API returned ${status} for ${url}${body ? `: ${body}` : ''}`);
    this.name = 'GitlabApiError';
  }
}

// url is always the full absolute URL — both products already build it
// themselves (apiUrl + path, or an already-absolute image URL) before
// calling this, so there's no apiUrl/path-splitting to get wrong here.
export async function gitlabFetch(
  url: string,
  privateToken: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Private-Token': privateToken, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new GitlabApiError(response.status, url, body);
  }

  return response;
}

// Deliberately just the fields an actual consumer reads so far (id/iid/
// project_id/title/description from sync/reports' original clients;
// state/user_notes_count added for harness's own live check,
// IMPROVEMENTS_HARNESS.md 1.2) — reports' own ResType is a richer,
// independently-typed superset for its own UI needs; this isn't meant to
// replace it, only to be the common wire shape this module's own fetch
// functions return. state/user_notes_count are optional even though
// GitLab's real API always sends them, so a literal object in an existing
// test fixture that predates this field (e.g. pushIssue.test.ts's own
// `issue: GitlabIssue = {...}`) doesn't have to grow one to keep compiling.
export interface GitlabIssue {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description: string | null;
  state?: string;
  user_notes_count?: number;
}

export async function getIssue(
  apiUrl: string,
  privateToken: string,
  projectId: string | number,
  iid: string | number,
): Promise<GitlabIssue> {
  const url = `${apiUrl}/projects/${encodeURIComponent(String(projectId))}/issues/${encodeURIComponent(String(iid))}`;
  const response = await gitlabFetch(url, privateToken);

  return (await response.json()) as GitlabIssue;
}

// Without an assigneeId, scope=assigned_to_me lets GitLab resolve "me" from
// the token itself (sync's shape — it has no separate stored user id). With
// one, scope=all + an explicit assignee_id (reports' shape — it stores a
// configurable userId in Settings, which isn't necessarily the token's own
// identity) is used instead. These are genuinely different queries, not a
// stylistic difference — keep both call shapes exactly as each product
// already relied on.
export async function listAssignedOpenIssues(
  apiUrl: string,
  privateToken: string,
  options: { assigneeId?: string | number } = {},
): Promise<GitlabIssue[]> {
  const params = new URLSearchParams();
  if (options.assigneeId !== undefined) {
    params.set('assignee_id', String(options.assigneeId));
    params.set('scope', 'all');
  } else {
    params.set('scope', 'assigned_to_me');
  }
  params.set('state', 'opened');

  const url = `${apiUrl}/issues?${params.toString()}`;
  const response = await gitlabFetch(url, privateToken);

  return (await response.json()) as GitlabIssue[];
}

// GitLab's standard MR list entity carries a `pipeline` summary field
// (status, among others) inline — no second call needed to know the HEAD
// pipeline's state for each MR returned here. No `state` filter is sent, so
// this returns opened/closed/merged alike (GitLab's own default for this
// endpoint when the param is omitted) — a merged MR with a failed pipeline
// is exactly the "published — done, but actually broken" case
// IMPROVEMENTS_HARNESS.md 1.2 exists to catch.
export interface GitlabMergeRequest {
  iid: number;
  title: string;
  state: string;
  web_url: string;
  pipeline: { status: string } | null;
}

export async function listMergeRequestsForBranch(
  apiUrl: string,
  privateToken: string,
  projectId: string | number,
  sourceBranch: string,
): Promise<GitlabMergeRequest[]> {
  const params = new URLSearchParams({ source_branch: sourceBranch, order_by: 'updated_at' });
  const url = `${apiUrl}/projects/${encodeURIComponent(String(projectId))}/merge_requests?${params.toString()}`;
  const response = await gitlabFetch(url, privateToken);

  return (await response.json()) as GitlabMergeRequest[];
}
