import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { runOpenAiCompatible } from './openAiCompatibleRunner.js';

const options = { baseUrl: 'http://stub.invalid', apiKey: 'k', model: 'gpt-test' };

describe('runOpenAiCompatible job deadline', () => {
  const realFetch = globalThis.fetch;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'oai-runner-'));
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects while a request is in flight', async () => {
    globalThis.fetch = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as typeof fetch;

    await assert.rejects(
      runOpenAiCompatible(dir, 'task', options, () => {}, undefined, 50),
      /gpt-test job timed out after 0\.05s/,
    );
  });

  it('rejects between turns once the deadline has passed', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: null, tool_calls: [
          { id: 'c1', function: { name: 'list_files', arguments: '{}' } },
        ] } }],
      }));
    }) as typeof fetch;

    // Burns past the deadline synchronously while the first turn's tool output is logged.
    const onOutput = () => {
      const end = Date.now() + 80;
      while (Date.now() < end) { /* spin */ }
    };

    await assert.rejects(
      runOpenAiCompatible(dir, 'task', options, onOutput, undefined, 40),
      /gpt-test job timed out/,
    );
    assert.equal(calls, 1);
  });

  it('keeps running without a timeout', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'done' } }] }))) as typeof fetch;

    const result = await runOpenAiCompatible(dir, 'task', options, () => {});
    assert.equal(result.exitCode, 0);
  });
});
