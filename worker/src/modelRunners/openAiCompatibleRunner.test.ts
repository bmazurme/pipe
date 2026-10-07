import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { runOpenAiCompatible } from './openAiCompatibleRunner.js';

const originalFetch = globalThis.fetch;

describe('runOpenAiCompatible', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('rejects with "returned no message" when choices is absent', async () => {
    globalThis.fetch = (async () => new Response('{}', { status: 200 })) as typeof fetch;
    await assert.rejects(
      runOpenAiCompatible(
        process.cwd(),
        'prompt',
        { baseUrl: 'http://provider.test', apiKey: 'key', model: 'test-model' },
        () => {},
      ),
      /test-model returned no message/,
    );
  });
});
