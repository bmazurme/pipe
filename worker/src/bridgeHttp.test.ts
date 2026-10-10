import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import { API_TIMEOUT_MS, bearer, bridgeFetch, readOptionalJson } from './bridgeHttp.js';

const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
});

describe('bridgeHttp', () => {
  describe('bearer', () => {
    it('adds the content type only for json', () => {
      assert.deepEqual(bearer('k'), { Authorization: 'Bearer k' });
      assert.deepEqual(bearer('k', true), { Authorization: 'Bearer k', 'Content-Type': 'application/json' });
    });
  });

  describe('bridgeFetch', () => {
    it('sets an abort signal on the request', async () => {
      let signal: AbortSignal | null | undefined;

      globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        signal = init?.signal;
        return new Response('ok');
      }) as typeof fetch;

      await bridgeFetch('http://bridge.local/x');

      assert.ok(signal instanceof AbortSignal);
      assert.equal(signal.aborted, false);
      assert.ok(API_TIMEOUT_MS > 0);
    });

    it('throws "<what> failed (<status>)" on a non-ok response when expectOk is set', async () => {
      globalThis.fetch = (async () => new Response('boom', { status: 500 })) as typeof fetch;

      await assert.rejects(bridgeFetch('http://bridge.local/x', {}, { expectOk: 'Doing x' }), {
        message: 'Doing x failed (500)',
      });
      await assert.rejects(bridgeFetch('http://bridge.local/x', {}, { expectOk: 'Doing x', includeBody: true }), {
        message: 'Doing x failed (500): boom',
      });
    });

    it('returns a non-ok response untouched when expectOk is not set', async () => {
      globalThis.fetch = (async () => new Response('', { status: 404 })) as typeof fetch;

      const response = await bridgeFetch('http://bridge.local/x');

      assert.equal(response.status, 404);
    });
  });

  describe('readOptionalJson', () => {
    it('returns null for an empty body', async () => {
      assert.equal(await readOptionalJson(new Response(null, { status: 204 })), null);
    });

    it('returns null for a JSON null body', async () => {
      assert.equal(await readOptionalJson(new Response('null')), null);
    });

    it('parses a JSON body', async () => {
      assert.deepEqual(await readOptionalJson(new Response('{"id":1}')), { id: 1 });
    });
  });
});
