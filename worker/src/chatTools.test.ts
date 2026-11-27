import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { combineToolsets, createBridgeToolset, createChatToolset, parseChatToolsMode, toolsetForTurn } from './chatTools.js';

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
  it('defaults to read (A11: the tools are read-only and for the owner), off only when asked, and accepts read/write in any case', () => {
    assert.equal(parseChatToolsMode(undefined), 'read');
    assert.equal(parseChatToolsMode(''), 'read');
    assert.equal(parseChatToolsMode('off'), 'off');
    assert.equal(parseChatToolsMode(' OFF '), 'off');
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

  it('get_job rejects a missing, non-integer or non-positive id without calling bridge', async () => {
    const calls = stubBridge({ '/worker/jobs/': { id: 7, status: 'running', model: 'opus' } });
    const toolset = createChatToolset('https://b', 'k', 'read')!;

    for (const args of [{ id: 'abc' }, {}, { id: 1.5 }, { id: 0 }, { id: -3 }]) {
      assert.equal(await toolset.execute('get_job', args), 'get_job needs a positive integer id.');
    }

    assert.equal(calls.length, 0);
  });

  it('get_job still requests /worker/jobs/<id> for a valid id', async () => {
    const calls = stubBridge({ '/worker/jobs/7': { id: 7, status: 'running', model: 'opus' } });
    const toolset = createChatToolset('https://b', 'k', 'read')!;

    assert.equal(JSON.parse(await toolset.execute('get_job', { id: 7 })).id, 7);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://b/api/v1/worker/jobs/7');
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

const BRIDGE_TOOLS = {
  definitions: [{ type: 'function', function: { name: 'system_status', description: 'd', parameters: { type: 'object', properties: {}, required: [] } } }],
  prompt: 'You can look at the live system.',
};

describe('createBridgeToolset (A11)', () => {
  it('asks bridge which tools there are, with the worker key', async () => {
    const calls = stubBridge({ '/api/v1/chat/tools': BRIDGE_TOOLS });
    const toolset = await createBridgeToolset('https://b', 'brw_key');

    assert.equal(toolset?.definitions[0].function.name, 'system_status');
    assert.equal(toolset?.systemPrompt, 'You can look at the live system.');
    assert.equal(calls[0].url, 'https://b/api/v1/chat/tools');
    assert.equal(calls[0].auth, 'Bearer brw_key');
  });

  it('is absent when bridge offers none (not the owner) or refuses', async () => {
    stubBridge({ '/api/v1/chat/tools': { definitions: [], prompt: '' } });
    assert.equal(await createBridgeToolset('https://b', 'k'), null);

    globalThis.fetch = (async () => new Response('no', { status: 403 })) as typeof fetch;
    assert.equal(await createBridgeToolset('https://b', 'k'), null);
  });

  it('relays a call to bridge and returns its answer', async () => {
    const calls = stubBridge({ '/api/v1/chat/tools/call': { result: 'RENDERED' }, '/api/v1/chat/tools': BRIDGE_TOOLS });
    const toolset = await createBridgeToolset('https://b', 'brw_key');

    // the stub matches by substring, so the longer route must be looked up first
    calls.length = 0;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });

      return new Response(JSON.stringify({ result: 'RENDERED' }), { status: 200 });
    }) as typeof fetch;

    assert.equal(await toolset!.execute('explain_run', { id: 5 }), 'RENDERED');
    assert.equal(calls[0].url, 'https://b/api/v1/chat/tools/call');
    assert.equal(calls[0].method, 'POST');
    assert.deepEqual(calls[0].body, { name: 'explain_run', args: { id: 5 } });
  });

  it('turns a refusal or an outage into text the model can explain, not a crash', async () => {
    stubBridge({ '/api/v1/chat/tools': BRIDGE_TOOLS });

    const toolset = await createBridgeToolset('https://b', 'k');

    globalThis.fetch = (async () => new Response('forbidden', { status: 403 })) as typeof fetch;
    assert.match(await toolset!.execute('system_status', {}), /Tool system_status failed: bridge answered 403/);

    globalThis.fetch = (async () => {
      throw new Error('ECONNRESET');
    }) as typeof fetch;
    assert.match(await toolset!.execute('system_status', {}), /Tool system_status failed: .*ECONNRESET/);
  });
});

describe('combineToolsets', () => {
  const make = (name: string, answer: string) => ({
    definitions: [{ type: 'function' as const, function: { name, description: '', parameters: {} } }],
    systemPrompt: `prompt-${name}`,
    execute: async () => answer,
  });

  it('is whichever one exists when the other does not', () => {
    const one = make('a', 'A');

    assert.equal(combineToolsets(one, null), one);
    assert.equal(combineToolsets(null, one), one);
    assert.equal(combineToolsets(null, null), null);
  });

  it('offers both and sends a call to the set that has the name', async () => {
    const both = combineToolsets(make('a', 'from-a'), make('b', 'from-b'))!;

    assert.deepEqual(both.definitions.map((d) => d.function.name), ['a', 'b']);
    assert.equal(await both.execute('a', {}), 'from-a');
    assert.equal(await both.execute('b', {}), 'from-b');
    assert.equal(both.systemPrompt, 'prompt-a prompt-b');
  });
});

describe('toolsetForTurn', () => {
  const base = { bridgeApiUrl: 'https://b', bridgeApiKey: 'k' };

  it('offers nothing when switched off or without a key', async () => {
    stubBridge({ '/api/v1/chat/tools': BRIDGE_TOOLS });

    assert.equal(await toolsetForTurn({ ...base, chatTools: 'off' }), null);
    assert.equal(await toolsetForTurn({ ...base, chatTools: 'read', bridgeApiKey: undefined }), null);
  });

  it('a worker added from the UI gets bridge\'s tools only', async () => {
    stubBridge({ '/api/v1/chat/tools': BRIDGE_TOOLS });

    const toolset = await toolsetForTurn({ ...base, chatTools: 'read', chatToolsViaBridge: true });

    assert.deepEqual(toolset?.definitions.map((d) => d.function.name), ['system_status']);
  });

  it('a worker with a personal key also keeps the older tools that look at jobs and parcels', async () => {
    stubBridge({ '/api/v1/chat/tools': BRIDGE_TOOLS });

    const names = (await toolsetForTurn({ ...base, chatTools: 'read' }))?.definitions.map((d) => d.function.name);

    assert.deepEqual(names, ['system_status', 'get_worker_status', 'list_jobs', 'get_job', 'list_files']);
  });

  it('only write mode can start a job', async () => {
    stubBridge({ '/api/v1/chat/tools': BRIDGE_TOOLS });

    const read = (await toolsetForTurn({ ...base, chatTools: 'read' }))?.definitions.map((d) => d.function.name);
    const write = (await toolsetForTurn({ ...base, chatTools: 'write' }))?.definitions.map((d) => d.function.name);

    assert.ok(!read?.includes('create_job'));
    assert.ok(write?.includes('create_job'));
  });

  it('carries on without bridge\'s tools when bridge cannot be asked, and says so', async () => {
    const warnings: string[] = [];

    globalThis.fetch = (async () => {
      throw new Error('ETIMEDOUT');
    }) as typeof fetch;

    assert.equal(await toolsetForTurn({ ...base, chatTools: 'read', chatToolsViaBridge: true }, (m) => warnings.push(m)), null);
    assert.match(warnings[0], /Could not ask bridge for chat tools: ETIMEDOUT/);

    const legacy = await toolsetForTurn({ ...base, chatTools: 'read' }, () => undefined);

    assert.deepEqual(legacy?.definitions.map((d) => d.function.name), ['get_worker_status', 'list_jobs', 'get_job', 'list_files']);
  });
});
