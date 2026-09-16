import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { getIssue, listAssignedOpenIssues } from './gitlabClient.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('listAssignedOpenIssues', () => {
  it('requests the assigned-to-me scope with the private token header', async () => {
    let capturedUrl: string | undefined;
    let capturedHeaders: HeadersInit | undefined;

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = init?.headers;
      return new Response(JSON.stringify([{ id: 1, iid: 2, project_id: 3, title: 't', description: null }]), {
        status: 200,
      });
    }) as typeof fetch;

    const issues = await listAssignedOpenIssues('https://gitlab.example.com/api/v4', 'tok');

    assert.equal(capturedUrl, 'https://gitlab.example.com/api/v4/issues?scope=assigned_to_me&state=opened');
    assert.deepEqual(capturedHeaders, { 'Private-Token': 'tok' });
    assert.equal(issues.length, 1);
    assert.equal(issues[0].iid, 2);
  });

  it('throws a descriptive error on a non-ok response', async () => {
    globalThis.fetch = (async () => new Response('nope', { status: 403 })) as typeof fetch;

    await assert.rejects(
      () => listAssignedOpenIssues('https://gitlab.example.com/api/v4', 'tok'),
      /GitLab API returned 403/,
    );
  });
});

describe('getIssue', () => {
  beforeEach(() => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ id: 1, iid: 2, project_id: 3, title: 't', description: null }), {
        status: 200,
      })) as typeof fetch;
  });

  it('fetches a single issue by project id and iid', async () => {
    const issue = await getIssue('https://gitlab.example.com/api/v4', 'tok', 173, 628);

    assert.equal(issue.iid, 2);
  });
});
