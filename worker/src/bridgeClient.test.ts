import { describe, it, before, after } from 'node:test';
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

    it('returns null when nothing is queued', async () => {
      globalThis.fetch = (async () => new Response('null', { status: 200 })) as typeof fetch;

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
