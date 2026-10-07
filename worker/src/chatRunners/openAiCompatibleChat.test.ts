import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import { openAiCompatibleChat } from './openAiCompatibleChat.js';

const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
});

describe('openAiCompatibleChat', () => {
  it('sends the full history with no tools and returns the reply text', async () => {
    let capturedUrl: string | undefined;
    let capturedBody: unknown;

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'sure, here you go' } }] }),
        { status: 200 },
      );
    }) as typeof fetch;

    const reply = await openAiCompatibleChat(
      [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }, { role: 'user', content: 'again' }],
      { baseUrl: 'https://api.deepseek.com/v1', apiKey: 'ds-x', model: 'deepseek-chat' },
    );

    assert.equal(capturedUrl, 'https://api.deepseek.com/v1/chat/completions');
    assert.deepEqual(capturedBody, {
      model: 'deepseek-chat',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: 'again' },
      ],
    });
    assert.ok(!('tools' in (capturedBody as object)));
    assert.equal(reply, 'sure, here you go');
  });

  it('passes a dispatcher only when a proxy URL is given', async () => {
    let capturedInit: RequestInit | undefined;

    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
    }) as typeof fetch;

    await openAiCompatibleChat(
      [{ role: 'user', content: 'hi' }],
      { baseUrl: 'https://api.deepseek.com/v1', apiKey: 'x', model: 'deepseek-chat' },
    );
    assert.equal((capturedInit as { dispatcher?: unknown })?.dispatcher, undefined);

    await openAiCompatibleChat(
      [{ role: 'user', content: 'hi' }],
      { baseUrl: 'https://api.deepseek.com/v1', apiKey: 'x', model: 'deepseek-chat' },
      'http://vpn-client:1080',
    );
    assert.ok((capturedInit as { dispatcher?: unknown })?.dispatcher);
  });

  it('throws a descriptive error on a failure status', async () => {
    globalThis.fetch = (async () => new Response('nope', { status: 500 })) as typeof fetch;

    await assert.rejects(
      openAiCompatibleChat([{ role: 'user', content: 'hi' }], {
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'x',
        model: 'deepseek-chat',
      }),
      /deepseek-chat API error \(500\)/,
    );
  });

  describe('malformed or empty replies', () => {
    const emptyOptions = { baseUrl: 'http://provider.test', apiKey: 'key', model: 'test-model' };
    const history = [{ role: 'user' as const, content: 'hi' }];
    const stubFetch = (body: unknown): void => {
      globalThis.fetch = (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
    };

    it('returns a normal reply unchanged', async () => {
      stubFetch({ choices: [{ message: { content: 'hello there' } }] });
      assert.equal(await openAiCompatibleChat(history, emptyOptions), 'hello there');
    });

    for (const [name, body] of [
      ['choices is empty', { choices: [] }],
      ['choices is missing', {}],
      ['message is missing', { choices: [{}] }],
      ['content is null', { choices: [{ message: { content: null } }] }],
      ['content is whitespace only', { choices: [{ message: { content: '  \n ' } }] }],
    ] as const) {
      it(`rejects when ${name}`, async () => {
        stubFetch(body);
        await assert.rejects(openAiCompatibleChat(history, emptyOptions), /test-model returned an empty reply/);
      });
    }
  });
});
