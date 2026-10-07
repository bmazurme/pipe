import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { CREDENTIALS_PATH } from './paths.js';
import { saveApiKey } from './credentials.js';
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
