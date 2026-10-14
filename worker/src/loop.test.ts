import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { RemoteJob } from './bridgeClient.js';
import type { ClaimedChatTurn } from './chatBridgeClient.js';
import type { WorkerConfig } from './config.js';
import { configFor, runLoop, type LoopDeps } from './loop.js';
import { WorkerRevokedError, type RemoteWorkerConfig } from './remoteConfig.js';
import type { Session } from './session.js';

const baseConfig: WorkerConfig = {
  bridgeApiUrl: 'https://bridge.example.com',
  stateDir: '/state',
  pollIntervalSec: 10,
  workDir: '/work',
  workerName: 'from-env',
  jobTimeoutSec: 1800,
  chatTools: 'read',
  proxyUrl: 'http://vpn:1080',
};

const legacy: Session = { mode: 'legacy', key: 'brk_k', name: 'old-host' };
const managed: Session = { mode: 'managed', key: 'brw_k', name: 'green' };

const remote = (over: Partial<RemoteWorkerConfig> = {}): RemoteWorkerConfig => ({
  id: 5,
  name: 'green',
  enabled: true,
  models: null,
  pollIntervalSec: 3,
  jobTimeoutSec: 600,
  proxyUrl: null,
  chatEnabled: true,
  ...over,
});

const job = { id: 1, model: 'gpt', status: 'claimed' } as unknown as RemoteJob;
const turn = { messageId: 9, chatId: 2, model: 'gpt', history: [] } as unknown as ClaimedChatTurn;

// A scripted run: each loop pass consumes one entry of every queue; when `passes` run out the loop is told to stop.
function harness(options: {
  session: Session | null;
  jobs?: (RemoteJob | null | Error)[];
  turns?: (ClaimedChatTurn | null | Error)[];
  remotes?: (RemoteWorkerConfig | Error)[];
  passes: number;
  sessionAfterRevoke?: Session | null;
}) {
  const controller = new AbortController();
  const events: string[] = [];
  const claimNames: string[] = [];
  const configsSeen: WorkerConfig[] = [];
  let pass = 0;
  const next = <T>(queue: T[] | undefined, fallback: T): T => (queue && queue.length > 0 ? (queue.shift() as T) : fallback);
  const jobs = [...(options.jobs ?? [])];
  const turns = [...(options.turns ?? [])];
  const remotes = [...(options.remotes ?? [])];

  const tick = () => {
    pass += 1;
    if (pass >= options.passes) controller.abort();
  };

  const deps: LoopDeps = {
    baseConfig,
    signal: controller.signal,
    initialSession: options.session,
    waitForSession: async () => {
      events.push('wait-for-enrolment');

      return options.sessionAfterRevoke ?? null;
    },
    makeClients: (session) => {
      events.push(`clients:${session.key}`);

      return {
        client: {
          claim: async (name: string) => {
            claimNames.push(name);
            events.push('claim-job');
            const value = next<RemoteJob | null | Error>(jobs, null);
            if (value instanceof Error) throw value;
            return value;
          },
        } as never,
        chatClient: {
          claim: async () => {
            events.push('claim-chat');
            const value = next<ClaimedChatTurn | null | Error>(turns, null);
            if (value instanceof Error) throw value;
            return value;
          },
        } as never,
      };
    },
    fetchRemoteConfig: async () => {
      events.push('fetch-config');
      const value = next<RemoteWorkerConfig | Error>(remotes, remote());
      if (value instanceof Error) throw value;
      return value;
    },
    forgetRevokedKey: () => {
      events.push('forget-key');
    },
    processJob: async (_client, _job, config) => {
      events.push('process-job');
      configsSeen.push(config);
      tick();
    },
    processChatTurn: async (_chat, _turn, config) => {
      events.push('process-chat');
      configsSeen.push(config);
    },
    withHeartbeat: async (_client, name, work) => {
      events.push(`heartbeat:${name}`);
      const result = await work();
      tick();
      return result;
    },
    sleep: async (ms) => {
      events.push(`sleep:${ms}`);
      tick();
    },
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
  };

  return { deps, events, claimNames, configsSeen };
}

describe('configFor', () => {
  it('a legacy worker keeps what the environment says (its own name aside)', () => {
    const config = configFor(baseConfig, legacy, null);

    assert.equal(config.workerName, 'old-host');
    assert.equal(config.chatTools, 'read');
    assert.equal(config.pollIntervalSec, 10);
  });

  it('a managed worker takes the page’s settings, and loses the bridge tools its key cannot reach', () => {
    const config = configFor(baseConfig, managed, remote());

    assert.equal(config.pollIntervalSec, 3);
    assert.equal(config.jobTimeoutSec, 600);
    assert.equal(config.chatTools, 'off');
    assert.equal(config.bridgeApiKey, 'brw_k');
    assert.equal(config.proxyUrl, 'http://vpn:1080');
  });
});

describe('runLoop', () => {
  it('does nothing when the process was stopped before it was enrolled', async () => {
    const h = harness({ session: null, passes: 1 });

    await runLoop(h.deps);

    assert.deepEqual(h.events, []);
  });

  it('a legacy worker claims jobs and never asks bridge for settings', async () => {
    const h = harness({ session: legacy, jobs: [job], passes: 2 });

    await runLoop(h.deps);

    assert.ok(!h.events.includes('fetch-config'));
    assert.deepEqual(h.events.slice(0, 3), ['clients:brk_k', 'claim-job', 'process-job']);
    assert.equal(h.claimNames[0], 'old-host');
  });

  it('with nothing queued it tries a chat turn, then sleeps one poll interval', async () => {
    const h = harness({ session: legacy, passes: 1 });

    await runLoop(h.deps);

    assert.deepEqual(h.events, ['clients:brk_k', 'claim-job', 'claim-chat', 'sleep:10000']);
  });

  it('a chat turn runs under a heartbeat, so the worker does not look dead during a long reply', async () => {
    const h = harness({ session: legacy, turns: [turn], passes: 1 });

    await runLoop(h.deps);

    assert.deepEqual(h.events.slice(-3), ['claim-chat', 'heartbeat:old-host', 'process-chat']);
  });

  it('a managed worker fetches its settings before every poll and polls at the interval the page set', async () => {
    const h = harness({ session: managed, remotes: [remote({ pollIntervalSec: 4 })], passes: 1 });

    await runLoop(h.deps);

    assert.deepEqual(h.events, ['clients:brw_k', 'fetch-config', 'claim-job', 'claim-chat', 'sleep:4000']);
  });

  it('the settings fetched on this pass are the ones the job runs with', async () => {
    const h = harness({ session: managed, jobs: [job], remotes: [remote({ jobTimeoutSec: 90 })], passes: 1 });

    await runLoop(h.deps);

    assert.equal(h.configsSeen[0].jobTimeoutSec, 90);
    assert.equal(h.claimNames[0], 'green');
  });

  it('a paused worker takes nothing — not even a chat turn — and just waits', async () => {
    const h = harness({ session: managed, remotes: [remote({ enabled: false })], jobs: [job], turns: [turn], passes: 1 });

    await runLoop(h.deps);

    assert.deepEqual(h.events, ['clients:brw_k', 'fetch-config', 'sleep:3000']);
  });

  it('with chat switched off for it, it never claims a chat turn', async () => {
    const h = harness({ session: managed, remotes: [remote({ chatEnabled: false })], turns: [turn], passes: 1 });

    await runLoop(h.deps);

    assert.ok(!h.events.includes('claim-chat'));
    assert.ok(h.events.includes('claim-job'));
  });

  it('carries on with the last settings when bridge cannot be reached for a moment', async () => {
    const h = harness({
      session: managed,
      remotes: [remote({ pollIntervalSec: 7 }), new Error('fetch failed')],
      passes: 2,
    });

    await runLoop(h.deps);

    const sleeps = h.events.filter((event) => event.startsWith('sleep:'));

    assert.deepEqual(sleeps, ['sleep:7000', 'sleep:7000']);
  });

  it('a worker bridge no longer knows forgets its key and waits to be enrolled again', async () => {
    const h = harness({
      session: managed,
      remotes: [new WorkerRevokedError()],
      sessionAfterRevoke: null,
      passes: 5,
    });

    await runLoop(h.deps);

    assert.deepEqual(h.events, ['clients:brw_k', 'fetch-config', 'forget-key', 'wait-for-enrolment']);
    assert.ok(!h.events.includes('claim-job'), 'nothing is claimed with a revoked key');
  });

  it('…and goes on working under the new identity once it is enrolled again', async () => {
    const reborn: Session = { mode: 'managed', key: 'brw_new', name: 'green-2' };
    const h = harness({
      session: managed,
      remotes: [new WorkerRevokedError(), remote({ name: 'green-2' })],
      sessionAfterRevoke: reborn,
      passes: 1,
    });

    await runLoop(h.deps);

    assert.ok(h.events.includes('clients:brw_new'));
    assert.equal(h.claimNames[0], 'green-2');
  });

  it('a failing job poll is logged and the loop carries on', async () => {
    const h = harness({ session: legacy, jobs: [new Error('boom')], passes: 1 });

    await runLoop(h.deps);

    assert.ok(h.events.includes('claim-chat'));
  });
});
