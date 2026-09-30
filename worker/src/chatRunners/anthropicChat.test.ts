import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import { anthropicChat } from './anthropicChat.js';

const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
});

describe('anthropicChat', () => {
  it('sends the full history and returns the joined text blocks', async () => {
    let capturedUrl: string | undefined;
    let capturedHeaders: Record<string, string> | undefined;
    let capturedBody: unknown;

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = init?.headers as Record<string, string>;
      capturedBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({ content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'there' }] }),
        { status: 200 },
      );
    }) as typeof fetch;

    const reply = await anthropicChat(
      [{ role: 'user', content: 'hi' }],
      { apiKey: 'sk-ant', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5' },
    );

    assert.equal(capturedUrl, 'https://api.anthropic.com/v1/messages');
    assert.equal(capturedHeaders?.['x-api-key'], 'sk-ant');
    assert.equal(capturedHeaders?.['anthropic-version'], '2023-06-01');
    assert.deepEqual(capturedBody, {
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      messages: [{ role: 'user', content: 'hi' }],
    });
    assert.equal(reply, 'Hello \nthere');
  });

  it('throws a descriptive error on a failure status', async () => {
    globalThis.fetch = (async () => new Response('bad key', { status: 401 })) as typeof fetch;

    await assert.rejects(
      anthropicChat([{ role: 'user', content: 'hi' }], {
        apiKey: 'bad',
        baseUrl: 'https://api.anthropic.com/v1',
        model: 'claude-sonnet-4-5',
      }),
      /Anthropic API error \(401\)/,
    );
  });
});
