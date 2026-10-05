import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import type { ActionDeps } from './actions.js';
import type { StatusPaths } from './collect.js';
import { createPipeMcpServer } from './mcp.js';

// Real protocol round-trip (InMemoryTransport.createLinkedPair — a real
// Client talking real MCP JSON-RPC to a real McpServer, just without a
// subprocess/stdio in between) rather than calling the tool handlers
// directly — the thing actually worth verifying here is that registerTool's
// zod schemas/annotations are wired correctly and the server responds the
// way a real client (Claude Code, a Chat tool loop) would see it. Manually
// smoke-tested once against a spawned `node dist/mcp.js` + StdioClientTransport
// too, to confirm stdio itself isn't corrupted by a spawned sync-cli child's
// output — not repeated here since that's exactly what mcpRunSyncCli's own
// capturing (not inheriting) stdio is for, and this fixture never spawns a
// real sync-cli anyway (ActionDeps is faked below).
function makeFixturePaths(dir: string): StatusPaths {
  return {
    syncState: path.join(dir, 'sync-state.json'),
    syncAgentState: path.join(dir, 'sync-agent-state.json'),
    gitlabWorkerState: path.join(dir, 'gitlab-worker-state.json'),
    reportsState: path.join(dir, 'reports-state.json'),
  };
}

function makeFakeActionDeps(overrides: Partial<ActionDeps> = {}): ActionDeps {
  return {
    loadSyncConfig: () => ({ projects: [{ name: 'bff', gitlabProjectId: '402' }] }),
    runSyncCli: async () => ({ code: 0, output: '' }),
    callPublish: async () => {},
    confirm: async () => true,
    isInteractive: false,
    ...overrides,
  };
}

describe('pipe-mcp', () => {
  let dir: string;
  let client: Client;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'harness-mcp-'));
  });

  afterEach(async () => {
    await client?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function connect(serverOptions: Parameters<typeof createPipeMcpServer>[0] = {}) {
    const server = createPipeMcpServer({ paths: makeFixturePaths(dir), ...serverOptions });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return client;
  }

  it('lists all six tools', async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      ['next', 'publish', 'pull', 'retry', 'status', 'task_log'],
    );
  });

  it('status reflects a real task from the fixture state files', async () => {
    const paths = makeFixturePaths(dir);
    writeFileSync(paths.reportsState, JSON.stringify({ '402:6': { step: 'pushed', pushedAt: new Date().toISOString() } }));

    const c = await connect();
    const result = await c.callTool({ name: 'status', arguments: {} });
    const content = result.content as { type: string; text: string }[];

    assert.match(content[0].text, /402:6/);
    assert.match(content[0].text, /pushed/);
  });

  it('next recommends the only in-progress task', async () => {
    const paths = makeFixturePaths(dir);
    writeFileSync(paths.reportsState, JSON.stringify({ '402:6': { step: 'init' } }));

    const c = await connect();
    const result = await c.callTool({ name: 'next', arguments: {} });
    const content = result.content as { type: string; text: string }[];

    assert.match(content[0].text, /402:6 \[other\]/);
  });

  it('task_log reports no transitions for an unknown key', async () => {
    const c = await connect({ eventsPaths: { log: path.join(dir, 'events.jsonl'), snapshot: path.join(dir, 'snapshot.json') } });
    const result = await c.callTool({ name: 'task_log', arguments: { key: '999:999' } });
    const content = result.content as { type: string; text: string }[];

    assert.match(content[0].text, /No recorded transitions for 999:999/);
  });

  it('pull refuses without yes and never touches runSyncCli', async () => {
    const calls: unknown[] = [];
    const actionDeps = makeFakeActionDeps({ runSyncCli: async (...args) => (calls.push(args), { code: 0, output: '' }) });

    const c = await connect({ actionDeps });
    const result = await c.callTool({ name: 'pull', arguments: { key: '402:6', yes: false } });

    assert.equal(result.isError, true);
    assert.equal(calls.length, 0);
  });

  it('pull with yes:true and dryRun describes the command without running it', async () => {
    const calls: unknown[] = [];
    const actionDeps = makeFakeActionDeps({ runSyncCli: async (...args) => (calls.push(args), { code: 0, output: '' }) });

    const c = await connect({ actionDeps });
    const result = await c.callTool({ name: 'pull', arguments: { key: '402:6', yes: true, dryRun: true } });
    const content = result.content as { type: string; text: string }[];

    assert.equal(result.isError, false);
    assert.match(content[0].text, /pull-issue bff 402 6/);
    assert.equal(calls.length, 0);
  });

  it('retry with yes:true actually calls runSyncCli with push-issue', async () => {
    const calls: unknown[][] = [];
    const actionDeps = makeFakeActionDeps({
      runSyncCli: async (...args) => {
        calls.push(args);
        return { code: 0, output: '' };
      },
    });

    const c = await connect({ actionDeps });
    const result = await c.callTool({ name: 'retry', arguments: { key: '402:6', yes: true } });

    assert.equal(result.isError, false);
    assert.deepEqual(calls[0][0], ['push-issue', 'bff', '402', '6']);
  });

  it('publish surfaces a failure as isError, with the real message as the tool text', async () => {
    const actionDeps = makeFakeActionDeps({
      callPublish: async () => {
        throw new Error('publish failed (500): boom');
      },
    });

    const c = await connect({ actionDeps });
    const result = await c.callTool({ name: 'publish', arguments: { key: '402:6', yes: true } });
    const content = result.content as { type: string; text: string }[];

    assert.equal(result.isError, true);
    assert.match(content[0].text, /publish failed \(500\): boom/);
  });
});
