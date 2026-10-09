import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { settleWithLimit } from './gitlabLive.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('settleWithLimit', () => {
  it('never runs more than the limit at once, and still does all the work', async () => {
    let running = 0;
    let peak = 0;

    const results = await settleWithLimit([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await sleep(5);
      running -= 1;

      return n * 2;
    });

    assert.equal(peak, 3);
    assert.deepEqual(results.map((result) => (result.status === 'fulfilled' ? result.value : null)), [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
  });

  it('keeps the order of the input and reports a failure in place without losing the rest', async () => {
    const results = await settleWithLimit(['a', 'b', 'c'], 2, async (item) => {
      if (item === 'b') throw new Error('rate limited');

      return item.toUpperCase();
    });

    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'rejected');
    assert.equal(results[2].status === 'fulfilled' && results[2].value, 'C');
  });

  it('handles an empty list', async () => {
    assert.deepEqual(await settleWithLimit([], 5, async () => 1), []);
  });
});
