import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import { WorkerBridgeClient } from './bridgeClient.js';

const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
});

describe('WorkerBridgeClient', () => {
  describe('claim', () => {
    it('sends the worker name and returns the claimed job', async () => {
      let capturedUrl: string | undefined;
      let capturedBody: unknown;

      globalThis.fetch = (async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
        return new Response(JSON.stringify({ id: 1, status: 'claimed' }), { status: 200 });
      }) as typeof fetch;

      const client = new WorkerBridgeClient('http://bridge.local', 'brk_test');
      const job = await client.claim('worker-1');

      assert.equal(capturedUrl, 'http://bridge.local/api/v1/worker/jobs/claim');
      assert.deepEqual(capturedBody, { workerName: 'worker-1' });
      assert.equal(job?.id, 1);
    });

    // Regression test: bridge actually sends 204 with a genuinely empty
    // body for "nothing to claim" (a bare `return null` from a Nest
    // handler doesn't serialize to JSON "null" — it sends no body and no
    // content-type at all). A naive `await response.json()` throws
    // "Unexpected end of JSON input" on that empty body — this is exactly
    // what broke worker's very first real deployment.
    it('returns null when nothing is queued (bridge sends 204, no body)', async () => {
      globalThis.fetch = (async () => new Response(null, { status: 204 })) as typeof fetch;

      const client = new WorkerBridgeClient('http://bridge.local', 'brk_test');
      assert.equal(await client.claim('worker-1'), null);
    });

    // Same case, pre-fix bridge behavior: an empty body with 201 rather
    // than 204 — the client doesn't assume a specific status code for
    // "empty", so this must also work against a bridge that hasn't
    // redeployed the 204 fix yet.
    it('returns null when nothing is queued (older bridge: empty body, 201)', async () => {
      globalThis.fetch = (async () => new Response(null, { status: 201 })) as typeof fetch;

      const client = new WorkerBridgeClient('http://bridge.local', 'brk_test');
      assert.equal(await client.claim('worker-1'), null);
    });

    it('throws with the response status on failure', async () => {
      globalThis.fetch = (async () => new Response('nope', { status: 500 })) as typeof fetch;

      const client = new WorkerBridgeClient('http://bridge.local', 'brk_test');
      await assert.rejects(client.claim('worker-1'), /Claim failed \(500\)/);
    });
  });

  describe('updateStatus', () => {
    it('posts the status and error message', async () => {
      let capturedBody: unknown;

      globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
        return new Response('{}', { status: 200 });
      }) as typeof fetch;

      const client = new WorkerBridgeClient('http://bridge.local', 'brk_test');
      await client.updateStatus(1, 'failed', 'boom');

      assert.deepEqual(capturedBody, { status: 'failed', errorMessage: 'boom' });
    });
  });

  describe('uploadResult retry', () => {
    const client = new WorkerBridgeClient('http://bridge.local', 'brk_test');
    const upload = (delays: number[]) => client.uploadResult(1, 'r.zip', Buffer.from('x'), delays);

    it('retries after a 503', async () => {
      let calls = 0;
      globalThis.fetch = (async () => {
        calls++;
        return calls === 1 ? new Response('down', { status: 503 }) : new Response('{}', { status: 200 });
      }) as typeof fetch;

      await upload([0, 0]);
      assert.equal(calls, 2);
    });

    it('retries after a network error', async () => {
      let calls = 0;
      globalThis.fetch = (async () => {
        calls++;
        if (calls === 1) throw new TypeError('fetch failed');
        return new Response('{}', { status: 200 });
      }) as typeof fetch;

      await upload([0, 0]);
      assert.equal(calls, 2);
    });

    it('does not retry a 400 or 404', async () => {
      for (const status of [400, 404]) {
        let calls = 0;
        globalThis.fetch = (async () => {
          calls++;
          return new Response('bad', { status });
        }) as typeof fetch;

        await assert.rejects(upload([0, 0]), new RegExp(`failed \\(${status}\\): bad`));
        assert.equal(calls, 1);
      }
    });

    it('throws the last error once attempts are exhausted', async () => {
      let calls = 0;
      globalThis.fetch = (async () => new Response(`n${++calls}`, { status: 502 })) as typeof fetch;

      await assert.rejects(upload([0, 0]), /Uploading result for job 1 failed \(502\): n3/);
      assert.equal(calls, 3);
    });
  });

  describe('appendLog', () => {
    it('posts the chunk', async () => {
      let capturedBody: unknown;

      globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
        return new Response(null, { status: 204 });
      }) as typeof fetch;

      const client = new WorkerBridgeClient('http://bridge.local', 'brk_test');
      await client.appendLog(1, 'hello\n');

      assert.deepEqual(capturedBody, { chunk: 'hello\n' });
    });
  });
});
