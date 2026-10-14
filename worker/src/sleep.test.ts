import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { sleep } from './sleep.js';

describe('sleep', () => {
  it('waits roughly as long as asked', async () => {
    const started = Date.now();

    await sleep(30);

    assert.ok(Date.now() - started >= 25);
  });

  it('returns at once when the signal is already aborted', async () => {
    const controller = new AbortController();

    controller.abort();
    const started = Date.now();
    await sleep(5_000, controller.signal);

    assert.ok(Date.now() - started < 500);
  });

  it('wakes early when the process is asked to stop — an idle worker exits promptly on SIGTERM', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const waiting = sleep(10_000, controller.signal);

    setTimeout(() => controller.abort(), 20);
    await waiting;

    assert.ok(Date.now() - started < 1_000);
  });
});
