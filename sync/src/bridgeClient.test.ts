import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { BridgeClient } from './bridgeClient.js';
import { CREDENTIALS_PATH } from './paths.js';

const API = 'http://bridge.test';

type Call = { url: string; authorization: string | null };

describe('BridgeClient 401 handling', () => {
  const realFetch = globalThis.fetch;
  const originalCredentials = existsSync(CREDENTIALS_PATH)
    ? readFileSync(CREDENTIALS_PATH, 'utf-8')
    : undefined;
  let calls: Call[];

  function useCredentials(credentials: object): void {
    writeFileSync(CREDENTIALS_PATH, JSON.stringify(credentials));
  }

  function mockFetch(handler: (url: string, n: number) => Response): void {
    calls = [];
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({ url, authorization: headers.get('Authorization') });
      return handler(url, calls.length);
    }) as typeof fetch;
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  beforeEach(() => {
    calls = [];
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (originalCredentials === undefined) rmSync(CREDENTIALS_PATH, { force: true });
    else writeFileSync(CREDENTIALS_PATH, originalCredentials);
  });

  it('refreshes and retries exactly once after a 401', async () => {
    useCredentials({ refreshToken: 'r' });
    let refreshes = 0;
    mockFetch((url) => {
      if (url.endsWith('/auth/refresh')) {
        refreshes += 1;
        return json({ accessToken: `token-${refreshes}` });
      }
      return calls.filter((c) => c.url.includes('/storage')).length === 1
        ? new Response('expired', { status: 401 })
        : json([]);
    });

    const client = new BridgeClient(API);
    assert.deepEqual(await client.listFiles(), []);

    const storageCalls = calls.filter((c) => c.url.includes('/storage'));
    assert.equal(storageCalls.length, 2);
    assert.equal(refreshes, 2);
    assert.equal(storageCalls[0].authorization, 'Bearer token-1');
    assert.equal(storageCalls[1].authorization, 'Bearer token-2');
  });

  it('surfaces the 401 error when the retry also returns 401', async () => {
    useCredentials({ refreshToken: 'r' });
    mockFetch((url) =>
      url.endsWith('/auth/refresh') ? json({ accessToken: 'a' }) : new Response('no', { status: 401 }),
    );

    await assert.rejects(new BridgeClient(API).listFiles(), /Failed to list storage files \(401\)/);
    assert.equal(calls.filter((c) => c.url.includes('/storage')).length, 2);
  });

  it('never refreshes or retries with an API key', async () => {
    useCredentials({ refreshToken: '', apiKey: 'key' });
    mockFetch(() => new Response('no', { status: 401 }));

    await assert.rejects(new BridgeClient(API).listFiles(), /\(401\)/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].authorization, 'Bearer key');
  });

  it('fails descriptively when the refresh body has no accessToken', async () => {
    useCredentials({ refreshToken: 'r' });
    mockFetch(() => json({}));

    await assert.rejects(new BridgeClient(API).listFiles(), /did not include a string "accessToken"/);
  });
});
