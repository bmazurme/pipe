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
    status;
    url;
    body;
    constructor(status, url, body) {
        super(`GitLab API returned ${status} for ${url}${body ? `: ${body}` : ''}`);
        this.status = status;
        this.url = url;
        this.body = body;
        this.name = 'GitlabApiError';
    }
}
// url is always the full absolute URL — both products already build it
// themselves (apiUrl + path, or an already-absolute image URL) before
// calling this, so there's no apiUrl/path-splitting to get wrong here.
const ISSUES_PER_PAGE = 100;
// A hard stop (2 000 issues) so a server that never reports the last page cannot loop forever.
const MAX_ISSUE_PAGES = 20;
export async function gitlabFetch(url, privateToken, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
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
export async function getIssue(apiUrl, privateToken, projectId, iid) {
    const url = `${apiUrl}/projects/${encodeURIComponent(String(projectId))}/issues/${encodeURIComponent(String(iid))}`;
    const response = await gitlabFetch(url, privateToken);
    return (await response.json());
}
// Without an assigneeId, scope=assigned_to_me lets GitLab resolve "me" from
// the token itself (sync's shape — it has no separate stored user id). With
// one, scope=all + an explicit assignee_id (reports' shape — it stores a
// configurable userId in Settings, which isn't necessarily the token's own
// identity) is used instead. These are genuinely different queries, not a
// stylistic difference — keep both call shapes exactly as each product
// already relied on.
export async function listAssignedOpenIssues(apiUrl, privateToken, options = {}) {
    const params = new URLSearchParams();
    if (options.assigneeId !== undefined) {
        params.set('assignee_id', String(options.assigneeId));
        params.set('scope', 'all');
    }
    else {
        params.set('scope', 'assigned_to_me');
    }
    params.set('state', 'opened');
    // GitLab's default page is 20; without this (and the page loop below) everything past the
    // twentieth assigned issue was silently missing from sync, reports and harness.
    params.set('per_page', String(ISSUES_PER_PAGE));
    const issues = [];
    let page = '1';
    for (let fetched = 0; page && fetched < MAX_ISSUE_PAGES; fetched += 1) {
        params.set('page', page);
        const response = await gitlabFetch(`${apiUrl}/issues?${params.toString()}`, privateToken);
        issues.push(...(await response.json()));
        // GitLab names the following page in X-Next-Page, and leaves it empty on the last one.
        page = response.headers.get('x-next-page')?.trim() || null;
    }
    return issues;
}
export async function listMergeRequestsForBranch(apiUrl, privateToken, projectId, sourceBranch) {
    const params = new URLSearchParams({ source_branch: sourceBranch, order_by: 'updated_at' });
    const url = `${apiUrl}/projects/${encodeURIComponent(String(projectId))}/merge_requests?${params.toString()}`;
    const response = await gitlabFetch(url, privateToken);
    return (await response.json());
}
// IMPROVEMENTS_HARNESS.md 4.2 — logs actual time spent (GitLab's own
// `/spend` quick action, same REST endpoint), deliberately NOT
// time_estimate (reports' own setIssueTimeEstimate, a different field for
// a different purpose — how long something is expected to take, not how
// long it took). `duration` is GitLab's own syntax (e.g. "2h30m", "1d").
// Writing here instead of only estimating matters: reports' own monthly
// report (reports/src/reports/handler.ts) already reads issues' time_stats
// from GitLab — logging spent time through this makes it show up there
// automatically, no new reports-side code needed at all.
export async function addSpentTime(apiUrl, privateToken, projectId, iid, duration) {
    const url = `${apiUrl}/projects/${encodeURIComponent(String(projectId))}/issues/${encodeURIComponent(String(iid))}/add_spent_time?duration=${encodeURIComponent(duration)}`;
    await gitlabFetch(url, privateToken, { method: 'POST' });
}
