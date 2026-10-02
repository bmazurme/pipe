import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import { ChatBridgeClient } from './chatBridgeClient.js';

const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
});

describe('ChatBridgeClient', () => {
  describe('claim', () => {
    it('posts to the claim endpoint and returns the claimed turn', async () => {
      let capturedUrl: string | undefined;

      globalThis.fetch = (async (url: string) => {
        capturedUrl = url;
        return new Response(
          JSON.stringify({ messageId: 1, chatId: 2, model: 'gpt', history: [{ role: 'user', content: 'hi' }] }),
          { status: 200 },
        );
      }) as typeof fetch;

      const client = new ChatBridgeClient('http://bridge.local', 'brk_test');
      const turn = await client.claim();

      assert.equal(capturedUrl, 'http://bridge.local/api/v1/chat/turns/claim');
      assert.equal(turn?.messageId, 1);
    });

    // Regression test: bridge actually sends 204 with a genuinely empty
    // body for "nothing pending" (a bare `return null` from a Nest handler
    // doesn't serialize to JSON "null" — it sends no body and no
    // content-type at all). A naive `await response.json()` throws
    // "Unexpected end of JSON input" on that empty body — this is exactly
    // what broke worker's very first real deployment.
    it('returns null when nothing is pending (bridge sends 204, no body)', async () => {
      globalThis.fetch = (async () => new Response(null, { status: 204 })) as typeof fetch;

      const client = new ChatBridgeClient('http://bridge.local', 'brk_test');
      assert.equal(await client.claim(), null);
    });

    // Same case, pre-fix bridge behavior: an empty body with 201 rather
    // than 204 — the client doesn't assume a specific status code for
    // "empty", so this must also work against a bridge that hasn't
    // redeployed the 204 fix yet.
    it('returns null when nothing is pending (older bridge: empty body, 201)', async () => {
      globalThis.fetch = (async () => new Response(null, { status: 201 })) as typeof fetch;

      const client = new ChatBridgeClient('http://bridge.local', 'brk_test');
      assert.equal(await client.claim(), null);
    });
  });

  describe('complete', () => {
    it('posts the reply content', async () => {
      let capturedBody: unknown;

      globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string);
        return new Response('{}', { status: 200 });
      }) as typeof fetch;

      const client = new ChatBridgeClient('http://bridge.local', 'brk_test');
      await client.complete(1, 'the answer');

      assert.deepEqual(capturedBody, { content: 'the answer' });
    });
  });

  describe('fail', () => {
    it('posts the error message', async () => {
      let capturedBody: unknown;

      globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string);
        return new Response('{}', { status: 200 });
      }) as typeof fetch;

      const client = new ChatBridgeClient('http://bridge.local', 'brk_test');
      await client.fail(1, 'boom');

      assert.deepEqual(capturedBody, { errorMessage: 'boom' });
    });
  });
});
