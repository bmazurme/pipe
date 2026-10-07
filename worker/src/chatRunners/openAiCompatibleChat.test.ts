import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { openAiCompatibleChat } from './openAiCompatibleChat.js';

const options = { baseUrl: 'http://provider.test', apiKey: 'key', model: 'test-model' };
const history = [{ role: 'user' as const, content: 'hi' }];
const originalFetch = globalThis.fetch;

function stubFetch(body: unknown): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
}

describe('openAiCompatibleChat', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns a normal reply unchanged', async () => {
    stubFetch({ choices: [{ message: { content: 'hello there' } }] });
    assert.equal(await openAiCompatibleChat(history, options), 'hello there');
  });

  it('rejects when choices is empty', async () => {
    stubFetch({ choices: [] });
    await assert.rejects(openAiCompatibleChat(history, options), /test-model returned an empty reply/);
  });

  it('rejects when choices is missing', async () => {
    stubFetch({});
    await assert.rejects(openAiCompatibleChat(history, options), /test-model returned an empty reply/);
  });

  it('rejects when message is missing', async () => {
    stubFetch({ choices: [{}] });
    await assert.rejects(openAiCompatibleChat(history, options), /test-model returned an empty reply/);
  });

  it('rejects on null content', async () => {
    stubFetch({ choices: [{ message: { content: null } }] });
    await assert.rejects(openAiCompatibleChat(history, options), /test-model returned an empty reply/);
  });

  it('rejects on whitespace-only content', async () => {
    stubFetch({ choices: [{ message: { content: '  \n ' } }] });
    await assert.rejects(openAiCompatibleChat(history, options), /test-model returned an empty reply/);
  });
});
