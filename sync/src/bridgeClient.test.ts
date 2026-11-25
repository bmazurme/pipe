import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { CREDENTIALS_PATH } from './paths.js';
import { saveApiKey, saveCredentials } from './credentials.js';
import { BridgeClient } from './bridgeClient.js';

// Shares CREDENTIALS_PATH with pushIssue.test.ts/gitlabWorker.test.ts — same
// backup/restore + --test-concurrency=1 reasoning as those two (see their
// own header comments).
const originalFetch = globalThis.fetch;
const originalCredentials = existsSync(CREDENTIALS_PATH) ? readFileSync(CREDENTIALS_PATH, 'utf-8') : null;

before(() => {
  saveApiKey('brk_test-key');
});

after(() => {
  if (originalCredentials === null) {
    rmSync(CREDENTIALS_PATH, { force: true });
  } else {
    writeFileSync(CREDENTIALS_PATH, originalCredentials);
  }
  globalThis.fetch = originalFetch;
});

// IMPROVEMENTS_TECH.md 2.3: listFiles() grew an optional filter so the
// reading side (pull-issue) can match a parcel by its addressing metadata
// instead of its filename — this covers the query-string building that adds.
describe('BridgeClient.listFiles', () => {
  it('sends no query string when the filter is empty', async () => {
    let requestedUrl: string | undefined;
    globalThis.fetch = (async (url: string) => {
      requestedUrl = url;
      return Response.json([]);
    }) as typeof fetch;

    await new BridgeClient('https://bridge.example.com').listFiles();

    assert.equal(requestedUrl, 'https://bridge.example.com/api/v1/storage');
  });

  it('builds a query string from channel/taskKey/direction', async () => {
    let requestedUrl: string | undefined;
    globalThis.fetch = (async (url: string) => {
      requestedUrl = url;
      return Response.json([]);
    }) as typeof fetch;

    await new BridgeClient('https://bridge.example.com').listFiles({
      channel: 'issue',
      taskKey: '402:6',
      direction: 'result',
    });

    assert.equal(
      requestedUrl,
      'https://bridge.example.com/api/v1/storage?channel=issue&taskKey=402%3A6&direction=result',
    );
  });

  it('returns the addressing fields bridge sends back on each file', async () => {
    globalThis.fetch = (async () =>
      Response.json([
        {
          id: 1,
          originalName: '402-6.subscription.zip',
          mimeType: 'application/zip',
          size: 10,
          createdAt: '2026-10-04T00:00:00.000Z',
          channel: 'issue',
          taskKey: '402:6',
          direction: 'result',
        },
      ])) as typeof fetch;

    const files = await new BridgeClient('https://bridge.example.com').listFiles({ taskKey: '402:6' });

    assert.equal(files[0]?.taskKey, '402:6');
    assert.equal(files[0]?.direction, 'result');
  });
});

describe('BridgeClient.createJob', () => {
  it('POSTs { sourceFileId, model } as JSON and returns the job', async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return Response.json({ id: 5, status: 'queued' }, { status: 201 });
    }) as typeof fetch;

    const job = await new BridgeClient('https://bridge.example.com').createJob(9, 'opus');

    assert.equal(seen?.url, 'https://bridge.example.com/api/v1/worker/jobs');
    assert.equal(seen?.init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(seen?.init?.body)), { sourceFileId: 9, model: 'opus' });
    assert.deepEqual(job, { id: 5, status: 'queued' });
    const headers = seen?.init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer brk_test-key');
    assert.equal(headers['Content-Type'], 'application/json');
  });

  it('keeps Content-Type on the retry after a 401 with refresh-token login', async () => {
    saveCredentials({ refreshToken: 'rt', gitlabToken: '' });
    try {
      const jobHeaders: Record<string, string>[] = [];
      let tokens = 0;
      globalThis.fetch = (async (url: string, init?: RequestInit) => {
        if (url.endsWith('/api/v1/auth/refresh')) {
          return Response.json({ accessToken: `at${++tokens}` });
        }
        jobHeaders.push(init?.headers as Record<string, string>);
        return jobHeaders.length === 1
          ? new Response('expired', { status: 401 })
          : Response.json({ id: 5, status: 'queued' }, { status: 201 });
      }) as typeof fetch;

      await new BridgeClient('https://bridge.example.com').createJob(9, 'opus');

      assert.equal(jobHeaders.length, 2);
      assert.equal(jobHeaders[1].Authorization, 'Bearer at2');
      assert.equal(jobHeaders[1]['Content-Type'], 'application/json');
    } finally {
      saveApiKey('brk_test-key');
    }
  });

  it('throws with the status and body on a non-2xx reply', async () => {
    globalThis.fetch = (async () => new Response('bad model', { status: 400 })) as typeof fetch;
    await assert.rejects(new BridgeClient('https://bridge.example.com').createJob(9, 'x'), /400.*bad model/);
  });
});

describe('BridgeClient.upload', () => {
  it('does not force a Content-Type, so fetch sets the multipart boundary', async () => {
    let init: RequestInit | undefined;
    globalThis.fetch = (async (_url: string, i?: RequestInit) => {
      init = i;
      return Response.json({ id: 1 });
    }) as typeof fetch;

    await new BridgeClient('https://bridge.example.com').upload('a.zip', Buffer.from('x'));

    const headers = init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer brk_test-key');
    assert.equal(Object.keys(headers).some((k) => k.toLowerCase() === 'content-type'), false);
    assert.ok(init?.body instanceof FormData);
  });
});
