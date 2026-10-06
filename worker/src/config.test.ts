import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('throws a clear error when BRIDGE_API_URL is missing', () => {
    assert.throws(() => loadConfig({ BRIDGE_API_KEY: 'x' }), /BRIDGE_API_URL/);
  });

  it('throws a clear error when BRIDGE_API_KEY is missing', () => {
    assert.throws(() => loadConfig({ BRIDGE_API_URL: 'http://x' }), /BRIDGE_API_KEY/);
  });

  it('strips a trailing slash from the bridge URL', () => {
    const config = loadConfig({ BRIDGE_API_URL: 'http://x/', BRIDGE_API_KEY: 'k' });
    assert.equal(config.bridgeApiUrl, 'http://x');
  });

  it('applies sensible defaults for the optional settings', () => {
    const config = loadConfig({ BRIDGE_API_URL: 'http://x', BRIDGE_API_KEY: 'k' });
    assert.equal(config.pollIntervalSec, 10);
    assert.ok(config.workerName.length > 0);
    assert.ok(config.workDir.endsWith('.worker-work'));
  });

  for (const bad of ['abc', '10s', '0', '-3', '']) {
    it(`rejects POLL_INTERVAL_SEC=${JSON.stringify(bad)}`, () => {
      assert.throws(
        () => loadConfig({ BRIDGE_API_URL: 'http://x', BRIDGE_API_KEY: 'k', POLL_INTERVAL_SEC: bad }),
        /POLL_INTERVAL_SEC must be a positive number/,
      );
    });
  }

  it('defaults WORKER_JOB_TIMEOUT_SEC to 30 minutes and honors an override', () => {
    const base = { BRIDGE_API_URL: 'http://x', BRIDGE_API_KEY: 'k' };
    assert.equal(loadConfig(base).jobTimeoutSec, 1800);
    assert.equal(loadConfig({ ...base, WORKER_JOB_TIMEOUT_SEC: '60' }).jobTimeoutSec, 60);
  });

  for (const bad of ['abc', '0', '-5']) {
    it(`rejects WORKER_JOB_TIMEOUT_SEC=${JSON.stringify(bad)}`, () => {
      assert.throws(
        () => loadConfig({ BRIDGE_API_URL: 'http://x', BRIDGE_API_KEY: 'k', WORKER_JOB_TIMEOUT_SEC: bad }),
        /WORKER_JOB_TIMEOUT_SEC must be a positive number/,
      );
    });
  }

  it('honors overrides for the optional settings', () => {
    const config = loadConfig({
      BRIDGE_API_URL: 'http://x',
      BRIDGE_API_KEY: 'k',
      POLL_INTERVAL_SEC: '5',
      WORKER_NAME: 'my-worker',
      WORKER_WORK_DIR: '/tmp/custom',
    });
    assert.equal(config.pollIntervalSec, 5);
    assert.equal(config.workerName, 'my-worker');
    assert.equal(config.workDir, '/tmp/custom');
  });
});
