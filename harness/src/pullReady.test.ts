import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { ActionDeps } from './actions.js';
import type { LiveStatusResult } from './bridgeLive.js';
import type { TaskEntry } from './collect.js';
import { annotateTasks } from './deriveStatus.js';
import { runPullReady } from './pullReady.js';

const NOW = Date.parse('2026-10-05T12:00:00.000Z');

const agentTask = (key: string): TaskEntry => ({
  key,
  gitlabWorker: { pushedAt: new Date(NOW).toISOString(), filename: 'x.zip' },
  syncAgent: { lastOwnOutputHash: 'abc' },
});
const tasks = annotateTasks([agentTask('402:7'), agentTask('402:6'), agentTask('402:8')], 24, NOW);

function live(ready: string[]): LiveStatusResult {
  return {
    available: true,
    data: { tasks: new Map(ready.map((k) => [k, { hasResultInStorage: true }])) },
  } as unknown as LiveStatusResult;
}

function makeDeps(overrides: Partial<ActionDeps> = {}) {
  const pulls: string[][] = [];
  const confirms: string[] = [];
  const deps: ActionDeps = {
    loadSyncConfig: () => ({ projects: [{ name: 'bff', gitlabProjectId: '402' }] }),
    runSyncCli: async (args) => {
      pulls.push(args);
      return { code: 0, output: '' };
    },
    callPublish: async () => {},
    confirm: async (m) => {
      confirms.push(m);
      return true;
    },
    isInteractive: true,
    ...overrides,
  };
  return { deps, pulls, confirms };
}

describe('runPullReady', () => {
  it('prints the live-check reason and exits 1 when bridge is unavailable', async () => {
    const { deps, pulls } = makeDeps();
    const result = await runPullReady(tasks, { available: false, reason: 'no key' }, { yes: true, dryRun: false }, deps);
    assert.equal(result.code, 1);
    assert.match(result.output, /no key/);
    assert.equal(pulls.length, 0);
  });

  it('says nothing is ready and exits 0 when no key is pullable', async () => {
    const { deps } = makeDeps();
    const result = await runPullReady(tasks, live([]), { yes: false, dryRun: false }, deps);
    assert.equal(result.code, 0);
    assert.equal(result.output, 'Nothing ready to pull.');
  });

  it('asks one confirmation for the whole list, then pulls sequentially in key order', async () => {
    const { deps, pulls, confirms } = makeDeps();
    const result = await runPullReady(tasks, live(['402:6', '402:7']), { yes: false, dryRun: false }, deps);
    assert.equal(confirms.length, 1);
    assert.match(confirms[0], /402:6, 402:7/);
    assert.deepEqual(pulls.map((a) => a[4]), ['6', '7']);
    assert.equal(result.code, 0);
    assert.equal(result.output, 'pulled 2, failed 0');
  });

  it('aborts without pulling when the confirmation is declined', async () => {
    const { deps, pulls } = makeDeps({ confirm: async () => false });
    const result = await runPullReady(tasks, live(['402:6']), { yes: false, dryRun: false }, deps);
    assert.equal(result.code, 1);
    assert.equal(pulls.length, 0);
  });

  it('refuses in a non-interactive session without --yes', async () => {
    const { deps, pulls, confirms } = makeDeps({ isInteractive: false });
    const result = await runPullReady(tasks, live(['402:6']), { yes: false, dryRun: false }, deps);
    assert.equal(result.code, 1);
    assert.match(result.output, /Refusing/);
    assert.equal(pulls.length, 0);
    assert.equal(confirms.length, 0);
  });

  it('skips the prompt with --yes', async () => {
    const { deps, pulls, confirms } = makeDeps({ isInteractive: false });
    const result = await runPullReady(tasks, live(['402:6']), { yes: true, dryRun: false }, deps);
    assert.equal(result.code, 0);
    assert.equal(confirms.length, 0);
    assert.equal(pulls.length, 1);
  });

  it('dry-run lists every pull without running or prompting', async () => {
    const { deps, pulls, confirms } = makeDeps({ isInteractive: false });
    const result = await runPullReady(tasks, live(['402:6', '402:7']), { yes: false, dryRun: true }, deps);
    assert.equal(result.code, 0);
    assert.match(result.output, /Would run "sync-cli pull-issue bff 402 6"/);
    assert.match(result.output, /Would run "sync-cli pull-issue bff 402 7"/);
    assert.equal(pulls.length, 0);
    assert.equal(confirms.length, 0);
  });

  it('continues past a failed pull and reports the failed keys with a non-zero code', async () => {
    const pulls: string[] = [];
    const { deps } = makeDeps({
      runSyncCli: async (args) => {
        pulls.push(args[4]);
        return { code: args[4] === '7' ? 1 : 0, output: '' };
      },
    });
    const result = await runPullReady(tasks, live(['402:6', '402:7', '402:8']), { yes: true, dryRun: false }, deps);
    assert.deepEqual(pulls, ['6', '7', '8']);
    assert.equal(result.code, 1);
    assert.equal(result.output, 'pulled 2, failed 1 (402:7)');
  });

  it('writes nothing to console.log and returns per-key output before the summary', async () => {
    const { deps } = makeDeps({ runSyncCli: async (args) => ({ code: 0, output: `out-${args[4]}` }) });
    const logged: unknown[][] = [];
    const original = console.log;
    console.log = (...a: unknown[]) => {
      logged.push(a);
    };
    let result;
    try {
      result = await runPullReady(tasks, live(['402:6', '402:7']), { yes: true, dryRun: false }, deps);
    } finally {
      console.log = original;
    }
    assert.equal(logged.length, 0);
    assert.equal(result.output, 'out-6\nout-7\npulled 2, failed 0');
  });
});
