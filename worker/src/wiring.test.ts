import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { WorkerConfig } from './config.js';
import { credentialsPath, saveCredentials } from './credentials.js';
import { buildLoopDeps } from './wiring.js';

const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
});

const stateDir = mkdtempSync(path.join(tmpdir(), 'wiring-'));

after(() => rmSync(stateDir, { recursive: true, force: true }));

const baseConfig: WorkerConfig = {
  bridgeApiUrl: 'https://bridge.example.com',
  stateDir,
  pollIntervalSec: 10,
  workDir: '/work',
  workerName: 'host',
  jobTimeoutSec: 1800,
  chatTools: 'off',
};

function build(
  vpn?: { apply: (link: string | null | undefined) => Promise<string | null> },
  limitsProbe?: { consider: (remote: never, key: string) => void },
) {
  const calls: string[] = [];
  const controller = new AbortController();
  const deps = buildLoopDeps({
    baseConfig,
    signal: controller.signal,
    initialSession: { mode: 'managed', key: 'brw_k', name: 'green' },
    waitForEnrolment: async () => null,
    processJob: async (_c, _j, _cfg, signal) => {
      calls.push(`job:${signal === controller.signal}`);
    },
    processChatTurn: async () => {
      calls.push('chat');
    },
    withHeartbeat: async (_c, _n, work) => work(),
    sleep: async (ms, signal) => {
      calls.push(`sleep:${ms}:${signal === controller.signal}`);
    },
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    vpn,
    limitsProbe: limitsProbe as never,
  });

  return { deps, calls, controller };
}

describe('buildLoopDeps', () => {
  it('builds the clients with the session’s own key and the configured bridge', async () => {
    const seen: { url: string; auth: string | null }[] = [];

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      seen.push({ url, auth: new Headers(init?.headers).get('authorization') });

      return new Response(null, { status: 204 });
    }) as typeof fetch;

    const { deps } = build();
    const { client, chatClient } = deps.makeClients({ mode: 'managed', key: 'brw_other', name: 'x' });

    await client.claim('x');
    await chatClient.claim();

    assert.deepEqual(seen, [
      { url: 'https://bridge.example.com/api/v1/worker/jobs/claim', auth: 'Bearer brw_other' },
      { url: 'https://bridge.example.com/api/v1/chat/turns/claim', auth: 'Bearer brw_other' },
    ]);
  });

  it('fetches settings from the configured bridge with the key it is given', async () => {
    let seenUrl = '';
    let seenAuth: string | null = null;

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      seenUrl = url;
      seenAuth = new Headers(init?.headers).get('authorization');

      return new Response(JSON.stringify({ id: 1 }), { status: 200 });
    }) as typeof fetch;

    await build().deps.fetchRemoteConfig('brw_k');

    assert.equal(seenUrl, 'https://bridge.example.com/api/v1/workers/me/config');
    assert.equal(seenAuth, 'Bearer brw_k');
  });

  it('routes through the worker’s own VPN tunnel when one is set on the page, whatever proxy address it carries', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ id: 1, proxyUrl: 'http://manual:1', vpnLink: 'vless://link' }), { status: 200 })) as typeof fetch;
    const applied: unknown[] = [];

    const remote = await build({
      apply: async (link) => {
        applied.push(link);

        return 'http://127.0.0.1:18080';
      },
    }).deps.fetchRemoteConfig('brw_k');

    assert.deepEqual(applied, ['vless://link']);
    assert.equal(remote.proxyUrl, 'http://127.0.0.1:18080');
  });

  it('keeps the proxy settings when there is no tunnel (none set, or it did not come up)', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ id: 1, proxyUrl: 'http://manual:1' }), { status: 200 })) as typeof fetch;

    const remote = await build({ apply: async () => null }).deps.fetchRemoteConfig('brw_k');

    assert.equal(remote.proxyUrl, 'http://manual:1');
  });

  it('lets the limits probe look at every settings fetch — with the proxy the worker really uses — without waiting for it', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ id: 1, proxyUrl: 'http://manual:1', vpnLink: 'vless://l' }), { status: 200 })) as typeof fetch;
    const seen: { proxyUrl: unknown; key: string }[] = [];

    const remote = await build(
      { apply: async () => 'http://127.0.0.1:18080' },
      {
        consider: (config, key) => {
          seen.push({ proxyUrl: (config as { proxyUrl: unknown }).proxyUrl, key });
          throw new Error('a broken probe');
        },
      },
    ).deps.fetchRemoteConfig('brw_k');

    assert.deepEqual(seen, [{ proxyUrl: 'http://127.0.0.1:18080', key: 'brw_k' }]);
    // the poll goes on with the settings, whatever the probe did
    assert.equal(remote.proxyUrl, 'http://127.0.0.1:18080');
  });

  it('forgetting a revoked key erases it from the state directory', async () => {
    saveCredentials(stateDir, {
      bridgeApiUrl: baseConfig.bridgeApiUrl,
      workerId: 1,
      name: 'green',
      key: 'brw_k',
      enrolledAt: '',
    });
    const { existsSync } = await import('node:fs');

    assert.equal(existsSync(credentialsPath(stateDir)), true);
    build().deps.forgetRevokedKey();
    assert.equal(existsSync(credentialsPath(stateDir)), false);
  });

  it('hands the shutdown signal to the job and to every sleep, so SIGTERM stops both', async () => {
    const { deps, calls } = build();

    await deps.processJob({} as never, {} as never, baseConfig);
    await deps.sleep(1000);

    assert.deepEqual(calls, ['job:true', 'sleep:1000:true']);
  });

  it('passes chat turns, the starting session and the enrolment wait straight through', async () => {
    const { deps, calls } = build();

    await deps.processChatTurn({} as never, {} as never, baseConfig);

    assert.deepEqual(calls, ['chat']);
    assert.equal(deps.initialSession?.name, 'green');
    assert.equal(await deps.waitForSession(), null);
  });
});
