import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { WorkerConfig } from './config.js';
import { EnrollmentRejectedError } from './enrollment.js';
import type { StoredCredentials } from './credentials.js';
import { resolveSession, waitForSession, type SessionDeps } from './session.js';

const config = (over: Partial<WorkerConfig> = {}): WorkerConfig => ({
  bridgeApiUrl: 'https://bridge.example.com',
  stateDir: '/state',
  pollIntervalSec: 10,
  workDir: '/work',
  workerName: 'host',
  jobTimeoutSec: 1800,
  chatTools: 'off',
  ...over,
});

const stored: StoredCredentials = {
  bridgeApiUrl: 'https://bridge.example.com',
  workerId: 5,
  name: 'green',
  key: 'brw_stored',
  enrolledAt: '',
};

function deps(over: Partial<SessionDeps> = {}): SessionDeps & { saved: StoredCredentials[]; enrolls: string[] } {
  const saved: StoredCredentials[] = [];
  const enrolls: string[] = [];

  return {
    version: '1.0.0',
    load: () => null,
    save: (_dir, credentials) => {
      saved.push(credentials);
    },
    enroll: async (_url, code) => {
      enrolls.push(code);

      return stored;
    },
    saved,
    enrolls,
    ...over,
  };
}

describe('resolveSession', () => {
  it('a personal API key in the environment keeps working the old way', async () => {
    const d = deps();
    const session = await resolveSession(config({ bridgeApiKey: 'brk_env' }), d);

    assert.deepEqual(session, { mode: 'legacy', key: 'brk_env', name: 'host' });
    assert.equal(d.enrolls.length, 0);
  });

  it('a stored key from an earlier enrolment is used — and a leftover code is not redeemed again', async () => {
    const d = deps({ load: () => stored });
    const session = await resolveSession(config({ enrollCode: 'brn_leftover' }), d);

    assert.deepEqual(session, { mode: 'managed', key: 'brw_stored', name: 'green' });
    assert.equal(d.enrolls.length, 0);
  });

  it('a one-time code in the environment is redeemed once and the key is stored', async () => {
    const d = deps();
    const session = await resolveSession(config({ enrollCode: 'brn_fresh' }), d);

    assert.deepEqual(d.enrolls, ['brn_fresh']);
    assert.equal(d.saved.length, 1);
    assert.equal(d.saved[0].key, 'brw_stored');
    assert.deepEqual(session, { mode: 'managed', key: 'brw_stored', name: 'green' });
  });

  it('is null when there is nothing to start with (not enrolled yet)', async () => {
    assert.equal(await resolveSession(config(), deps()), null);
  });

  it('a refused code is remembered, so it is not tried again every few seconds', async () => {
    const rejected = new Set<string>();
    const d = deps({
      enroll: async (_url, code) => {
        d.enrolls.push(code);
        throw new EnrollmentRejectedError();
      },
    });

    assert.equal(await resolveSession(config({ enrollCode: 'brn_bad' }), d, rejected), null);
    assert.equal(await resolveSession(config({ enrollCode: 'brn_bad' }), d, rejected), null);
    assert.equal(d.enrolls.length, 1);
    assert.equal(d.saved.length, 0);
  });

  it('bridge being unreachable while enrolling is not remembered — the code is still good', async () => {
    let attempts = 0;
    const d = deps({
      enroll: async () => {
        attempts += 1;
        throw new Error('fetch failed');
      },
    });
    const rejected = new Set<string>();

    await resolveSession(config({ enrollCode: 'brn_ok' }), d, rejected);
    await resolveSession(config({ enrollCode: 'brn_ok' }), d, rejected);

    assert.equal(attempts, 2);
  });
});

describe('waitForSession', () => {
  it('waits for an enrolment done from outside (the key appears in the state directory)', async () => {
    let calls = 0;
    const d = deps({ load: () => (++calls >= 3 ? stored : null) });
    const sleeps: number[] = [];

    const session = await waitForSession(config(), d, async (ms) => {
      sleeps.push(ms);
    });

    assert.equal(session?.key, 'brw_stored');
    assert.equal(sleeps.length, 2);
  });

  it('gives up cleanly when the process is asked to stop', async () => {
    const controller = new AbortController();
    const session = await waitForSession(config(), deps(), async () => controller.abort(), controller.signal);

    assert.equal(session, null);
  });
});
