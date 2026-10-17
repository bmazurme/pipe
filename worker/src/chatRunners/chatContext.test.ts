import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import { buildPrompt } from './claudeChat.js';
import { openAiCompatibleChat } from './openAiCompatibleChat.js';

const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
});

const history = [{ role: 'user' as const, content: 'hi' }];

describe('buildPrompt with a chat context', () => {
  it('puts the fenced context block in front of the prompt', () => {
    const prompt = buildPrompt(history, new Set(), 'Use tabs.');

    assert.ok(prompt.startsWith('Background context supplied by the user.'));
    assert.ok(prompt.includes('<context>\nUse tabs.\n</context>'));
    assert.ok(prompt.includes('User: hi'));
  });

  it('is unchanged when the context is null or blank', () => {
    const plain = buildPrompt(history);

    assert.equal(buildPrompt(history, new Set(), null), plain);
    assert.equal(buildPrompt(history, new Set(), '  \n'), plain);
  });
});

describe('openAiCompatibleChat with a chat context', () => {
  async function systemMessage(context?: string | null): Promise<string> {
    let body: { messages: { role: string; content: string }[] } | undefined;

    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      body = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
    }) as typeof fetch;

    await openAiCompatibleChat(history, { baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' }, undefined, null, context);

    return body!.messages[0].content;
  }

  it('appends the fenced context block to the system message', async () => {
    const system = await systemMessage('Use tabs.');

    assert.ok(system.includes('<context>\nUse tabs.\n</context>'));
    assert.ok(system.indexOf('<context>') > system.indexOf('pipe-action'));
  });

  it('leaves the system message unchanged when the context is null or blank', async () => {
    const plain = await systemMessage();

    assert.equal(await systemMessage(null), plain);
    assert.equal(await systemMessage('   '), plain);
  });
});
