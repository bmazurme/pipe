import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import type { ActionDeps } from './actions.js';
import type { StatusPaths } from './collect.js';
import { buildBrief, formatBrief } from './brief.js';
import type { EventsPaths } from './events.js';
import type { LogTimeDeps } from './timeTracking.js';
import { createPipeMcpServer, mcpRunSyncCli } from './mcp.js';

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

  it('brief returns the same text formatBrief produces for the same inputs', async () => {
    const eventsPaths: EventsPaths = { log: path.join(dir, 'events.jsonl'), snapshot: path.join(dir, 'last-snapshot.json') };
    const c = await connect({ eventsPaths });
    const result = (await c.callTool({ name: 'brief', arguments: { recentHours: 12 } })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    const expected = formatBrief(await buildBrief({ recentHours: 12, paths: makeFixturePaths(dir), eventsPaths }), 12);
    assert.equal(result.isError, false);
    assert.match(result.content[0].text, /== brief ==/);
    assert.equal(result.content[0].text, expected);
  });

  it('lists all eight tools', async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      ['brief', 'log_time', 'next', 'publish', 'pull', 'retry', 'status', 'task_log'],
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
    assert.deepEqual(calls[0][0], ['push-issue', '--', 'bff', '402', '6']);
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

  it('retry refuses a project override that looks like an option, without calling runSyncCli', async () => {
    const calls: unknown[][] = [];
    const actionDeps = makeFakeActionDeps({ runSyncCli: async (...args) => (calls.push(args), { code: 0, output: '' }) });

    const c = await connect({ actionDeps });
    const result = await c.callTool({ name: 'retry', arguments: { key: '402:6', yes: true, project: '--force' } });
    const content = result.content as { type: string; text: string }[];

    assert.equal(result.isError, true);
    assert.match(content[0].text, /unknown project "--force"/);
    assert.equal(calls.length, 0);
  });

  it('publish refuses a non-loopback reportsUrl, without calling callPublish', async () => {
    const calls: unknown[][] = [];
    const actionDeps = makeFakeActionDeps({
      callPublish: async (...args) => {
        calls.push(args);
      },
    });

    const c = await connect({ actionDeps });
    const result = await c.callTool({ name: 'publish', arguments: { key: '402:6', yes: true, reportsUrl: 'https://example.com' } });

    assert.equal(result.isError, true);
    assert.equal(calls.length, 0);
  });
});

describe('pipe-mcp log_time', () => {
  let dir: string;
  let client: Client;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'harness-mcp-logtime-'));
    writeFileSync(
      makeFixturePaths(dir).reportsState,
      JSON.stringify({ '402:6': { step: 'pulled', pushedAt: '2026-01-01T10:00:00.000Z', pulledAt: '2026-01-01T12:30:00.000Z' } }),
    );
  });

  afterEach(async () => {
    await client?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function makeDeps(calls: unknown[][]): LogTimeDeps {
    return {
      loadGitlabConfig: () => ({ apiUrl: 'https://gitlab.example/api/v4', token: 't' }) as ReturnType<LogTimeDeps['loadGitlabConfig']>,
      addSpentTime: (async (...args: unknown[]) => {
        calls.push(args);
      }) as LogTimeDeps['addSpentTime'],
      confirm: async () => true,
      isInteractive: false,
    };
  }

  async function connect(logTimeDeps: LogTimeDeps) {
    const server = createPipeMcpServer({ paths: makeFixturePaths(dir), logTimeDeps });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return client;
  }

  const textOf = (result: object) => ((result as { content: { text: string }[] }).content)[0].text;

  it('lists log_time with required yes and a key pattern', async () => {
    const c = await connect(makeDeps([]));
    const tool = (await c.listTools()).tools.find((t) => t.name === 'log_time');
    const schema = tool?.inputSchema as { required?: string[]; properties: Record<string, { pattern?: string }> };
    assert.ok(schema.required?.includes('yes'));
    assert.equal(schema.properties.key.pattern, '^\\d+:\\d+$');
  });

  it('refuses without yes and never calls addSpentTime', async () => {
    const calls: unknown[][] = [];
    const c = await connect(makeDeps(calls));
    const result = await c.callTool({ name: 'log_time', arguments: { key: '402:6', yes: false } });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /Refusing to .* without confirmation/);
    assert.equal(calls.length, 0);
  });

  it('dryRun describes the duration without logging', async () => {
    const calls: unknown[][] = [];
    const c = await connect(makeDeps(calls));
    const result = await c.callTool({ name: 'log_time', arguments: { key: '402:6', yes: false, dryRun: true } });
    assert.equal(result.isError, false);
    assert.match(textOf(result), /^Would log .* spent on 402:6/);
    assert.equal(calls.length, 0);
  });

  it('yes:true calls addSpentTime with project, iid and duration', async () => {
    const calls: unknown[][] = [];
    const c = await connect(makeDeps(calls));
    const result = await c.callTool({ name: 'log_time', arguments: { key: '402:6', yes: true } });
    assert.equal(result.isError, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][2], '402');
    assert.equal(calls[0][3], '6');
    assert.equal(typeof calls[0][4], 'string');
    assert.match(textOf(result), /^Logged .* on 402:6/);
  });

  it('returns an error for a task with no finished cycle', async () => {
    const calls: unknown[][] = [];
    const c = await connect(makeDeps(calls));
    const result = await c.callTool({ name: 'log_time', arguments: { key: '402:7', yes: true } });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /nothing to propose/);
    assert.equal(calls.length, 0);
  });

  it('rejects a malformed key at schema validation', async () => {
    const calls: unknown[][] = [];
    const c = await connect(makeDeps(calls));
    const result = await c.callTool({ name: 'log_time', arguments: { key: '402:6/../x', yes: true } }).catch((e: Error) => e);
    assert.ok(result instanceof Error || (result as { isError?: boolean }).isError === true);
    assert.equal(calls.length, 0);
  });
});

describe('mcpRunSyncCli', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pipe-mcp-cli-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps the final line of a large output from a child that exits immediately', async () => {
    const script = path.join(dir, 'big.js');
    writeFileSync(script, "process.stdout.write('x'.repeat(500000) + '\\nFINAL-LINE\\n'); process.exitCode = 3;");
    const result = await mcpRunSyncCli([], script, { outputCap: 1024 * 1024 });
    assert.equal(result.code, 3);
    assert.ok(result.output.endsWith('FINAL-LINE'));
  });

  it('times out a child that never exits and kills it', async () => {
    const script = path.join(dir, 'hang.js');
    const pidFile = path.join(dir, 'pid');
    writeFileSync(
      script,
      `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`,
    );
    const result = await mcpRunSyncCli([], script, { timeoutMs: 500 });
    assert.equal(result.code, 1);
    assert.match(result.output, /timed out after 500 ms/);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    let alive = true;
    for (let i = 0; i < 50 && alive; i++) {
      try {
        process.kill(pid, 0);
        await new Promise((r) => setTimeout(r, 50));
      } catch {
        alive = false;
      }
    }
    assert.equal(alive, false);
  });

  it('truncates output beyond the cap from the front', async () => {
    const script = path.join(dir, 'cap.js');
    writeFileSync(script, "process.stdout.write('HEAD' + 'y'.repeat(5000) + 'TAIL');");
    const result = await mcpRunSyncCli([], script, { outputCap: 100 });
    assert.ok(result.output.startsWith('[…truncated]'));
    assert.ok(result.output.endsWith('TAIL'));
    assert.ok(!result.output.includes('HEAD'));
  });
});
