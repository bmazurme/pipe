import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { withHeartbeat } from './heartbeat.js';

describe('withHeartbeat (chat turns)', () => {
  it('pings bridge every 10s while the work runs, returns its result, and stops after', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const names: string[] = [];
    let release!: (value: string) => void;
    const work = new Promise<string>((resolve) => {
      release = resolve;
    });

    const running = withHeartbeat({ heartbeat: async (name) => void names.push(name) }, 'pi-worker', () => work);

    t.mock.timers.tick(35_000);
    assert.deepEqual(names, ['pi-worker', 'pi-worker', 'pi-worker']);

    release('reply');
    assert.equal(await running, 'reply');

    t.mock.timers.tick(60_000);
    assert.equal(names.length, 3, 'the interval must be cleared once the work ends');
  });

  it('clears the interval and rethrows when the work fails', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    let pings = 0;
    let fail!: (error: Error) => void;
    const work = new Promise<string>((_, reject) => {
      fail = reject;
    });

    const running = withHeartbeat({ heartbeat: async () => void (pings += 1) }, 'pi-worker', () => work);
    t.mock.timers.tick(10_000);
    assert.equal(pings, 1);

    fail(new Error('model call broke'));
    await assert.rejects(running, /model call broke/);

    t.mock.timers.tick(60_000);
    assert.equal(pings, 1);
  });

  it('keeps the work going when a heartbeat fails', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    let release!: (value: string) => void;
    const work = new Promise<string>((resolve) => {
      release = resolve;
    });

    const running = withHeartbeat(
      {
        heartbeat: async () => {
          throw new Error('bridge unreachable');
        },
      },
      'pi-worker',
      () => work,
    );
    t.mock.timers.tick(25_000);
    await new Promise((resolve) => setImmediate(resolve));

    release('still fine');
    assert.equal(await running, 'still fine');
  });
});
