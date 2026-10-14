import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import { API_TIMEOUT_MS, bearer, bridgeFetch, readOptionalJson, reportClaudeUsage } from './bridgeHttp.js';

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

  describe('reportClaudeUsage', () => {
    it('posts the report, with the job id when there is one', async () => {
      const sent: { url: string; body: unknown; auth: unknown }[] = [];

      globalThis.fetch = (async (url: string, init?: RequestInit) => {
        sent.push({ url, body: JSON.parse(String(init?.body)), auth: (init?.headers as Record<string, string>).Authorization });
        return new Response(null, { status: 204 });
      }) as typeof fetch;

      await reportClaudeUsage('http://bridge.local', 'k', { limits: { status: 'allowed' } }, 7);
      await reportClaudeUsage('http://bridge.local', 'k', { usage: { costUsd: 1 } });

      assert.deepEqual(sent[0], { url: 'http://bridge.local/api/v1/worker/jobs/usage', body: { jobId: 7, limits: { status: 'allowed' } }, auth: 'Bearer k' });
      assert.deepEqual(sent[1].body, { usage: { costUsd: 1 } });
    });

    it('sends nothing for an empty report, and never throws', async () => {
      let calls = 0;

      globalThis.fetch = (async () => {
        calls += 1;
        throw new Error('network down');
      }) as typeof fetch;

      await reportClaudeUsage('http://bridge.local', 'k', {});
      assert.equal(calls, 0);
      await assert.doesNotReject(reportClaudeUsage('http://bridge.local', 'k', { limits: {} }));
      assert.equal(calls, 1);
    });

    it('ignores a bridge that answers an error (an older deployment without the route)', async () => {
      globalThis.fetch = (async () => new Response('nope', { status: 404 })) as typeof fetch;

      await assert.doesNotReject(reportClaudeUsage('http://bridge.local', 'k', { limits: {} }, 1));
    });
  });
});
