import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { LimitsProbe } from './limitsProbe.js';
import type { RemoteWorkerConfig } from './remoteConfig.js';

const NOW = Date.parse('2026-10-16T12:00:00.000Z');
const LIMITS = { status: 'allowed', rateLimitType: null, isUsingOverage: false, windows: { five_hour: { utilization: 0.3, resetsAt: 1 } } };
const wait = () => new Promise((resolve) => setTimeout(resolve, 15));

const config = (over: Partial<RemoteWorkerConfig> = {}): RemoteWorkerConfig =>
  ({
    id: 1,
    name: 'w',
    enabled: true,
    models: null,
    pollIntervalSec: 10,
    jobTimeoutSec: 1800,
    proxyUrl: null,
    chatEnabled: true,
    limitsRefreshMin: 0,
    limitsRefreshRequestedAt: null,
    limitProbe: { claudeToken: 'tok' },
    ...over,
  }) as RemoteWorkerConfig;

function setup(opts: { limits?: boolean; fail?: boolean; failModels?: string[] } = {}) {
  const clock = { now: NOW };
  const runs: { token: string; proxy: string | undefined; model: string }[] = [];
  const sent: { apiUrl: string; key: string; report: unknown }[] = [];
  const logs: string[] = [];
  const probe = new LimitsProbe({
    apiUrl: 'https://bridge.example',
    workDir: '/tmp/w',
    now: () => clock.now,
    log: { info: (_o, m) => logs.push(`info:${m}`), warn: (_o, m) => logs.push(`warn:${m}`) },
    run: async (_cwd, token, proxy, model) => {
      runs.push({ token, proxy, model });
      if (opts.fail || opts.failModels?.includes(model)) throw new Error('claude exploded');

      return { exitCode: 0, output: '', ...(opts.limits === false ? {} : { report: { limits: LIMITS } }) };
    },
    send: async (apiUrl, key, report) => void sent.push({ apiUrl, key, report }),
  });

  return { probe, clock, runs, sent, logs };
}

describe('LimitsProbe', () => {
  it('does nothing when no probe is due (no interval, no request) or bridge sent no token', async () => {
    const { probe, runs } = setup();

    probe.consider(config(), 'k');
    probe.consider(config({ limitsRefreshMin: 30, limitProbe: null }), 'k');
    await wait();

    assert.equal(runs.length, 0);
  });

  it('probes once when the owner asked, on the token bridge handed over and through the worker\'s proxy, and reports it as a probe', async () => {
    const { probe, runs, sent } = setup();
    const requested = new Date(NOW - 30_000).toISOString();

    probe.consider(config({ limitsRefreshRequestedAt: requested, proxyUrl: 'http://127.0.0.1:18080' }), 'brw_key');
    await wait();

    assert.deepEqual(runs, [{ token: 'tok', proxy: 'http://127.0.0.1:18080', model: 'haiku' }]);
    assert.deepEqual(sent, [{ apiUrl: 'https://bridge.example', key: 'brw_key', report: { limits: LIMITS, probe: true } }]);

    // the same request is not served again on the next poll
    probe.consider(config({ limitsRefreshRequestedAt: requested }), 'brw_key');
    await wait();
    assert.equal(runs.length, 1);
  });

  it('serves a newer request, and ignores one that has gone stale', async () => {
    const { probe, runs } = setup();

    probe.consider(config({ limitsRefreshRequestedAt: new Date(NOW - 20 * 60_000).toISOString() }), 'k');
    await wait();
    assert.equal(runs.length, 0);

    probe.consider(config({ limitsRefreshRequestedAt: new Date(NOW - 60_000).toISOString() }), 'k');
    await wait();
    probe.consider(config({ limitsRefreshRequestedAt: new Date(NOW - 1000).toISOString() }), 'k');
    await wait();
    assert.equal(runs.length, 2);
  });

  it('with an interval probes at once the first time, then only once the interval has passed', async () => {
    const { probe, runs, clock } = setup();

    probe.consider(config({ limitsRefreshMin: 30 }), 'k');
    await wait();
    assert.equal(runs.length, 1);

    clock.now += 29 * 60_000;
    probe.consider(config({ limitsRefreshMin: 30 }), 'k');
    await wait();
    assert.equal(runs.length, 1);

    clock.now += 2 * 60_000;
    probe.consider(config({ limitsRefreshMin: 30 }), 'k');
    await wait();
    assert.equal(runs.length, 2);
  });

  it('never runs two probes at once', async () => {
    let release: () => void = () => undefined;
    const runs: number[] = [];
    const probe = new LimitsProbe({
      apiUrl: 'x',
      workDir: '/tmp/w',
      now: () => NOW,
      run: () =>
        new Promise((resolve) => {
          runs.push(1);
          release = () => resolve({ exitCode: 0, output: '', report: { limits: LIMITS } });
        }),
      send: async () => undefined,
    });

    probe.consider(config({ limitsRefreshMin: 15 }), 'k');
    probe.consider(config({ limitsRefreshMin: 15 }), 'k');
    assert.equal(runs.length, 1);
    release();
    await wait();
  });

  it('survives a failing CLI and a CLI that reported no limits, and does not retry in a loop', async () => {
    const failing = setup({ fail: true });

    failing.probe.consider(config({ limitsRefreshMin: 15 }), 'k');
    await wait();
    failing.probe.consider(config({ limitsRefreshMin: 15 }), 'k');
    await wait();

    assert.ok(failing.logs.includes('warn:limits probe failed'));
    assert.ok(failing.logs.includes('warn:limits probe: no model answered'));
    // every model was tried once, in that one probe — and not retried in a loop on the next poll
    assert.deepEqual(failing.runs.map((r) => r.model), ['haiku', 'sonnet']);

    const silent = setup({ limits: false });

    silent.probe.consider(config({ limitsRefreshMin: 15 }), 'k');
    await wait();

    assert.equal(silent.sent.length, 0);
    assert.ok(silent.logs.includes('warn:limits probe: the CLI reported no limits'));
  });

  it('falls back to the next model when the cheapest one does not answer, and remembers the one that worked', async () => {
    const { probe, runs, sent, clock } = setup({ failModels: ['haiku'] });

    probe.consider(config({ limitsRefreshMin: 15 }), 'k');
    await wait();

    assert.deepEqual(runs.map((r) => r.model), ['haiku', 'sonnet']);
    assert.equal(sent.length, 1);

    // the next probe starts with sonnet — no waiting for haiku to fail again
    clock.now += 16 * 60_000;
    probe.consider(config({ limitsRefreshMin: 15 }), 'k');
    await wait();

    assert.deepEqual(runs.map((r) => r.model), ['haiku', 'sonnet', 'sonnet']);
  });

  it('keeps using the cheapest model while it works', async () => {
    const { probe, runs, clock } = setup();

    probe.consider(config({ limitsRefreshMin: 15 }), 'k');
    await wait();
    clock.now += 16 * 60_000;
    probe.consider(config({ limitsRefreshMin: 15 }), 'k');
    await wait();

    assert.deepEqual(runs.map((r) => r.model), ['haiku', 'haiku']);
  });
});
