import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import type { WorkerConfig } from './config.js';
import { applyRemoteConfig, fetchRemoteConfig, WorkerRevokedError, type RemoteWorkerConfig } from './remoteConfig.js';

const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
});

const base: WorkerConfig = {
  bridgeApiUrl: 'https://bridge.example.com',
  stateDir: '/state',
  pollIntervalSec: 10,
  workDir: '/work',
  workerName: 'from-env',
  jobTimeoutSec: 1800,
  chatTools: 'off',
  proxyUrl: 'http://vpn-client:1080',
};

const remote: RemoteWorkerConfig = {
  id: 5,
  name: 'green',
  enabled: true,
  models: null,
  pollIntervalSec: 5,
  jobTimeoutSec: 600,
  proxyUrl: null,
  chatEnabled: true,
};

describe('fetchRemoteConfig', () => {
  it('asks for this worker’s settings with its own key', async () => {
    let url = '';
    let auth: string | null = null;
    let version: string | null = null;

    globalThis.fetch = (async (u: string, init?: RequestInit) => {
      url = u;
      auth = new Headers(init?.headers).get('authorization');
      version = new Headers(init?.headers).get('x-worker-version');

      return new Response(JSON.stringify(remote), { status: 200 });
    }) as typeof fetch;

    assert.deepEqual(await fetchRemoteConfig('https://bridge.example.com', 'brw_k'), remote);
    assert.equal(url, 'https://bridge.example.com/api/v1/workers/me/config');
    assert.equal(auth, 'Bearer brw_k');
    // bridge decides from it which jobs this worker may be given
    assert.match(version ?? '', /^\d+\.\d+\.\d+/);
  });

  it('a 401 means the worker was deleted or reconnected — a distinct error', async () => {
    globalThis.fetch = (async () => new Response('{}', { status: 401 })) as typeof fetch;

    await assert.rejects(fetchRemoteConfig('https://bridge.example.com', 'brw_k'), WorkerRevokedError);
  });

  it('bridge being down is an ordinary error, not a revocation', async () => {
    globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch;

    await assert.rejects(fetchRemoteConfig('https://bridge.example.com', 'brw_k'), (error: unknown) => {
      assert.ok(!(error instanceof WorkerRevokedError));
      return true;
    });
  });
});

describe('applyRemoteConfig', () => {
  it('the page’s name, poll interval and job timeout win over the environment', () => {
    const config = applyRemoteConfig(base, remote);

    assert.equal(config.workerName, 'green');
    assert.equal(config.pollIntervalSec, 5);
    assert.equal(config.jobTimeoutSec, 600);
    assert.equal(config.workDir, '/work');
  });

  it('a proxy set on the page wins; one that is not set leaves the environment’s alone', () => {
    assert.equal(applyRemoteConfig(base, { ...remote, proxyUrl: ' http://other:3128 ' }).proxyUrl, 'http://other:3128');
    assert.equal(applyRemoteConfig(base, { ...remote, proxyUrl: null }).proxyUrl, 'http://vpn-client:1080');
    assert.equal(applyRemoteConfig(base, { ...remote, proxyUrl: '  ' }).proxyUrl, 'http://vpn-client:1080');
  });
});
