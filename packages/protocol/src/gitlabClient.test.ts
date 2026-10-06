import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { GitlabApiError, gitlabFetch, getIssue, listAssignedOpenIssues, listMergeRequestsForBranch, addSpentTime } from './gitlabClient.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('gitlabFetch', () => {
  it('sends the Private-Token header and returns the response on success', async () => {
    let capturedHeaders: HeadersInit | undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers;
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    const response = await gitlabFetch('https://gitlab.example.com/api/v4/user', 'tok');

    assert.equal(await response.text(), 'ok');
    assert.deepEqual(capturedHeaders, { 'Private-Token': 'tok' });
  });

  it('merges extra init headers alongside Private-Token', async () => {
    let capturedHeaders: HeadersInit | undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers;
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    await gitlabFetch('https://gitlab.example.com/api/v4/user', 'tok', { headers: { 'Content-Type': 'application/json' } });

    assert.deepEqual(capturedHeaders, { 'Private-Token': 'tok', 'Content-Type': 'application/json' });
  });

  it('throws a GitlabApiError carrying status/url/body on a non-ok response', async () => {
    globalThis.fetch = (async () => new Response('nope', { status: 403 })) as typeof fetch;

    await assert.rejects(
      () => gitlabFetch('https://gitlab.example.com/api/v4/user', 'tok'),
      (error: unknown) => {
        assert.ok(error instanceof GitlabApiError);
        assert.equal(error.status, 403);
        assert.equal(error.url, 'https://gitlab.example.com/api/v4/user');
        assert.equal(error.body, 'nope');
        assert.match(error.message, /GitLab API returned 403/);
        return true;
      },
    );
  });
});

describe('getIssue', () => {
  it('fetches a single issue by project id and iid', async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url;
      return Response.json({ id: 1, iid: 2, project_id: 3, title: 't', description: null });
    }) as typeof fetch;

    const issue = await getIssue('https://gitlab.example.com/api/v4', 'tok', 173, 628);

    assert.equal(capturedUrl, 'https://gitlab.example.com/api/v4/projects/173/issues/628');
    assert.equal(issue.iid, 2);
  });
});

describe('listAssignedOpenIssues', () => {
  it('without an assigneeId, uses scope=assigned_to_me (sync\'s shape)', async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url;
      return Response.json([]);
    }) as typeof fetch;

    await listAssignedOpenIssues('https://gitlab.example.com/api/v4', 'tok');

    assert.equal(capturedUrl, 'https://gitlab.example.com/api/v4/issues?scope=assigned_to_me&state=opened');
  });

  it('with an assigneeId, uses scope=all + assignee_id (reports\' shape)', async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url;
      return Response.json([]);
    }) as typeof fetch;

    await listAssignedOpenIssues('https://gitlab.example.com/api/v4', 'tok', { assigneeId: 42 });

    assert.equal(capturedUrl, 'https://gitlab.example.com/api/v4/issues?assignee_id=42&scope=all&state=opened');
  });
});

describe('listMergeRequestsForBranch', () => {
  it('queries by source_branch, with no state filter', async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url;
      return Response.json([{ iid: 42, title: 't', state: 'opened', web_url: 'https://gitlab.example.com/x/-/merge_requests/42', pipeline: { status: 'failed' } }]);
    }) as typeof fetch;

    const mrs = await listMergeRequestsForBranch('https://gitlab.example.com/api/v4', 'tok', 173, 'task/173-6');

    assert.equal(capturedUrl, 'https://gitlab.example.com/api/v4/projects/173/merge_requests?source_branch=task%2F173-6&order_by=updated_at');
    assert.equal(mrs[0].iid, 42);
    assert.equal(mrs[0].pipeline?.status, 'failed');
  });
});

describe('addSpentTime', () => {
  it('posts to add_spent_time with the duration as a query param, not time_estimate', async () => {
    let capturedUrl: string | undefined;
    let capturedMethod: string | undefined;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedMethod = init?.method;
      return new Response('', { status: 200 });
    }) as typeof fetch;

    await addSpentTime('https://gitlab.example.com/api/v4', 'tok', 173, 628, '2h30m');

    assert.equal(capturedUrl, 'https://gitlab.example.com/api/v4/projects/173/issues/628/add_spent_time?duration=2h30m');
    assert.equal(capturedMethod, 'POST');
  });
});
