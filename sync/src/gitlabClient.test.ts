import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { getIssue, getIssueImages, listAssignedOpenIssues } from './gitlabClient.js';

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

    assert.equal(capturedUrl, 'https://gitlab.example.com/api/v4/issues?scope=assigned_to_me&state=opened&per_page=100&page=1');
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

// The download logic itself is tested in @pipe/protocol's gitlabClient.test.ts —
// these only cover what sync's wrapper adds: its English warning lines.
describe('getIssueImages', () => {
  const PNG_BYTES = new Uint8Array([1, 2, 3, 4]);

  function captureWarnings(): { lines: unknown[][]; restore: () => void } {
    const original = console.warn;
    const lines: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      lines.push(args);
    };
    return { lines, restore: () => (console.warn = original) };
  }

  it('downloads a relative /uploads/ image into issue-images/', async () => {
    globalThis.fetch = (async () => new Response(PNG_BYTES, { status: 200 })) as typeof fetch;

    const images = await getIssueImages('https://gitlab.example.com/api/v4', 'tok', '![shot](/uploads/abc/shot.png)');

    assert.deepEqual(images, [{ relPath: 'issue-images/shot.png', base64: Buffer.from(PNG_BYTES).toString('base64') }]);
  });

  it('warns with the HTTP status and continues when one download fails', async () => {
    globalThis.fetch = (async () => new Response('nope', { status: 404 })) as typeof fetch;
    const warnings = captureWarnings();

    try {
      const images = await getIssueImages('https://gitlab.example.com/api/v4', 'tok', '![shot](/uploads/abc/shot.png)');
      assert.deepEqual(images, []);
    } finally {
      warnings.restore();
    }

    assert.deepEqual(warnings.lines, [
      ['Could not download an image from the issue description (https://gitlab.example.com/uploads/abc/shot.png): HTTP 404'],
    ]);
  });

  it('warns with the error itself on a network failure', async () => {
    const failure = new TypeError('fetch failed');
    globalThis.fetch = (async () => {
      throw failure;
    }) as typeof fetch;
    const warnings = captureWarnings();

    try {
      await getIssueImages('https://gitlab.example.com/api/v4', 'tok', '![shot](/uploads/abc/shot.png)');
    } finally {
      warnings.restore();
    }

    assert.deepEqual(warnings.lines, [
      ['Could not download an image from the issue description (https://gitlab.example.com/uploads/abc/shot.png):', failure],
    ]);
  });
});
