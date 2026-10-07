import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { createChatToolset, parseChatToolsMode } from './chatTools.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

interface Call {
  url: string;
  method: string;
  body?: unknown;
  auth?: string;
}

function stubBridge(routes: Record<string, unknown>): Call[] {
  const calls: Call[] = [];

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>;
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined, auth: headers?.Authorization });
    const key = Object.keys(routes).find((route) => url.includes(route));

    if (!key) return new Response('nope', { status: 404 });

    return new Response(JSON.stringify(routes[key]), { status: 200 });
  }) as typeof fetch;

  return calls;
}

describe('parseChatToolsMode', () => {
  it('defaults to off and accepts read/write in any case', () => {
    assert.equal(parseChatToolsMode(undefined), 'off');
    assert.equal(parseChatToolsMode(''), 'off');
    assert.equal(parseChatToolsMode('Read'), 'read');
    assert.equal(parseChatToolsMode(' write '), 'write');
  });

  it('rejects anything else instead of silently staying off', () => {
    assert.throws(() => parseChatToolsMode('true'), /must be "off", "read" or "write"/);
  });
});

describe('createChatToolset', () => {
  it('is absent when off', () => {
    assert.equal(createChatToolset('https://b', 'k', 'off'), null);
  });

  it('read mode offers only the read tools; write adds create_job', () => {
    const names = (mode: 'read' | 'write') => createChatToolset('https://b', 'k', mode)!.definitions.map((d) => d.function.name);

    assert.deepEqual(names('read'), ['get_worker_status', 'list_jobs', 'get_job', 'list_files']);
    assert.ok(names('write').includes('create_job'));
  });

  it('list_jobs summarizes jobs, filters by status and authenticates with the worker key', async () => {
    const calls = stubBridge({
      '/worker/jobs': [
        { id: 3, status: 'failed', model: 'sonnet', errorMessage: 'timed out', startedAt: '2026-10-07T10:00:00Z', finishedAt: '2026-10-07T10:03:00Z', logs: 'SECRET LOG' },
        { id: 2, status: 'succeeded', model: 'gpt' },
      ],
    });
    const toolset = createChatToolset('https://b', 'worker-key', 'read')!;

    const result = JSON.parse(await toolset.execute('list_jobs', { status: 'failed' }));

    assert.deepEqual(result, [{ id: 3, status: 'failed', model: 'sonnet', durationSec: 180, error: 'timed out' }]);
    assert.equal(calls[0].url, 'https://b/api/v1/worker/jobs');
    assert.equal(calls[0].auth, 'Bearer worker-key');
    // A listing never carries logs.
    assert.ok(!JSON.stringify(result).includes('SECRET LOG'));
  });

  it('get_job returns only the tail of a long log', async () => {
    stubBridge({ '/worker/jobs/9': { id: 9, status: 'running', model: 'opus', logs: `${'a'.repeat(4000)}END` } });
    const toolset = createChatToolset('https://b', 'k', 'read')!;

    const result = JSON.parse(await toolset.execute('get_job', { id: 9 }));

    assert.ok(result.logTail.endsWith('END'));
    assert.ok(result.logTail.length <= 1500);
  });

  it('turns a bridge failure into a readable tool result instead of throwing', async () => {
    stubBridge({});
    const toolset = createChatToolset('https://b', 'k', 'read')!;

    const result = await toolset.execute('get_worker_status', {});

    assert.match(result, /Tool get_worker_status failed: bridge answered 404/);
  });

  it('refuses create_job in read mode even if the model asks', async () => {
    const calls = stubBridge({ '/worker/jobs': { id: 1, status: 'queued', model: 'sonnet' } });
    const toolset = createChatToolset('https://b', 'k', 'read')!;

    assert.match(await toolset.execute('create_job', { sourceFileId: 1, model: 'sonnet' }), /not enabled/);
    assert.equal(calls.length, 0);
  });

  it('create_job validates its arguments, starts one job, and refuses a second in the same turn', async () => {
    const calls = stubBridge({ '/worker/jobs': { id: 15, status: 'queued', model: 'opus' } });
    const toolset = createChatToolset('https://b', 'k', 'write')!;

    assert.match(await toolset.execute('create_job', { sourceFileId: 'x', model: 'opus' }), /needs an integer sourceFileId/);
    assert.match(await toolset.execute('create_job', { sourceFileId: 4, model: 'gpt-9' }), /needs an integer sourceFileId/);
    assert.equal(calls.length, 0);

    const started = JSON.parse(await toolset.execute('create_job', { sourceFileId: 4, model: 'opus' }));

    assert.equal(started.id, 15);
    assert.deepEqual(calls[0].body, { sourceFileId: 4, model: 'opus' });
    assert.equal(calls[0].method, 'POST');
    assert.match(await toolset.execute('create_job', { sourceFileId: 5, model: 'opus' }), /Only one job can be started per message/);
    assert.equal(calls.length, 1);
  });

  it('reports an unknown tool name', async () => {
    const toolset = createChatToolset('https://b', 'k', 'read')!;

    assert.equal(await toolset.execute('rm_rf', {}), 'Unknown tool: rm_rf');
  });
});
