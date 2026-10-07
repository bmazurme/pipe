import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import { CancelledError } from '../cancelled.js';
import { executeTool, MAX_TOOL_RESULT_CHARS, runOpenAiCompatible } from './openAiCompatibleRunner.js';

describe('executeTool read_file', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'read-file-test-'));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns a file at the cap unchanged', () => {
    const content = 'a'.repeat(MAX_TOOL_RESULT_CHARS);
    writeFileSync(join(dir, 'small.txt'), content);
    assert.equal(executeTool(dir, 'read_file', { path: 'small.txt' }), content);
  });

  it('truncates a larger file with a notice including the total size', () => {
    const total = MAX_TOOL_RESULT_CHARS + 123;
    writeFileSync(join(dir, 'big.txt'), 'b'.repeat(total));
    const result = executeTool(dir, 'read_file', { path: 'big.txt' });
    assert.ok(result.startsWith('b'.repeat(MAX_TOOL_RESULT_CHARS)));
    assert.ok(result.includes(`[truncated: file has ${total} chars; ${MAX_TOOL_RESULT_CHARS} shown`));
    assert.ok(result.length < total);
  });

  it('reads the remainder with offset', () => {
    const total = MAX_TOOL_RESULT_CHARS + 10;
    writeFileSync(join(dir, 'big2.txt'), 'c'.repeat(total));
    const result = executeTool(dir, 'read_file', { path: 'big2.txt', offset: MAX_TOOL_RESULT_CHARS });
    assert.equal(result, 'c'.repeat(10));
  });
});

const deadlineOptions = { baseUrl: 'http://stub.invalid', apiKey: 'k', model: 'gpt-test' };

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

    // AbortSignal.timeout's timer is unref'd, so with nothing else scheduled the
    // event loop would drain while the mocked fetch is pending (Node 22 reports
    // that as a cancelled test) — hold it open until the deadline fires.
    const keepAlive = setTimeout(() => {}, 5000);
    try {
      await assert.rejects(
        runOpenAiCompatible(dir, 'task', deadlineOptions, () => {}, undefined, 50),
        /gpt-test job timed out after 0\.05s/,
      );
    } finally {
      clearTimeout(keepAlive);
    }
  });

  it('rejects on the next turn once the deadline has passed', async () => {
    let calls = 0;
    // Like a real fetch: yields to the event loop (so the deadline timer can fire)
    // and rejects with the abort reason when its signal is already aborted.
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (init?.signal?.aborted) throw init.signal.reason;

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
      runOpenAiCompatible(dir, 'task', deadlineOptions, onOutput, undefined, 40),
      /gpt-test job timed out/,
    );
    assert.equal(calls, 2);
  });

  it('keeps running without a timeout', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'done' } }] }))) as typeof fetch;

    const result = await runOpenAiCompatible(dir, 'task', deadlineOptions, () => {});
    assert.equal(result.exitCode, 0);
  });
});

describe('runOpenAiCompatible stop requests', () => {
  const realFetch = globalThis.fetch;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'oai-runner-stop-'));
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    rmSync(dir, { recursive: true, force: true });
  });

  const pendingUntilAborted = (() =>
    new Promise((_resolve, reject) => {
      // never answers; only an abort ends it
      setTimeout(() => reject(new Error('test would hang')), 10_000).unref();
    })) as unknown as typeof fetch;

  it('stops a request that is in flight when the owner asks', async () => {
    globalThis.fetch = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as typeof fetch;
    const stop = new AbortController();
    const keepAlive = setTimeout(() => {}, 5000); // AbortSignal.timeout timers are unref'd
    setTimeout(() => stop.abort(), 50);

    try {
      await assert.rejects(runOpenAiCompatible(dir, 'task', deadlineOptions, () => {}, undefined, undefined, stop.signal), CancelledError);
    } finally {
      clearTimeout(keepAlive);
    }
  });

  it('does not call the model at all when already stopped, and a stop wins over the deadline', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return pendingUntilAborted;
    }) as unknown as typeof fetch;
    const stop = new AbortController();
    stop.abort();

    await assert.rejects(runOpenAiCompatible(dir, 'task', deadlineOptions, () => {}, undefined, 1, stop.signal), CancelledError);
    assert.equal(calls, 0);
  });
});

