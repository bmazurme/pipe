import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { makeUnavailableCapabilities } from './ready.js';

describe('makeUnavailableCapabilities', () => {
  it('reports fusion while it is down, and caches the check for 30 s', async () => {
    let calls = 0;
    let ready = false;
    let t = 0;
    const get = makeUnavailableCapabilities(async () => {
      calls += 1;

      return ready;
    }, () => t);

    assert.deepEqual(await get(), ['fusion']);
    ready = true;
    t = 10_000;
    assert.deepEqual(await get(), ['fusion']);
    assert.equal(calls, 1);
    t = 31_000;
    assert.deepEqual(await get(), []);
    assert.equal(calls, 2);
  });
});
