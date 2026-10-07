import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { pullIssueCommand, watchForResult } from './pullIssue.js';

describe('watchForResult', () => {
  it('keeps polling after a thrown error and notifies once a pull succeeds', async () => {
    const results: Array<Error | boolean> = [new Error('bridge 503'), false, true];
    let calls = 0;
    let found = 0;
    const sleeps: number[] = [];

    await watchForResult(5, {
      pullOnce: async () => {
        const next = results[calls++];
        if (next instanceof Error) throw next;
        return next as boolean;
      },
      onFound: () => {
        found++;
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    assert.equal(calls, 3);
    assert.equal(found, 1);
    assert.deepEqual(sleeps, [5000, 5000]);
  });

  it('still rejects immediately on an invalid --watch value', async () => {
    await assert.rejects(pullIssueCommand('p', '1', '2', { watch: 'abc' }), /--watch expects a positive number/);
    await assert.rejects(pullIssueCommand('p', '1', '2', { watch: '0' }), /--watch expects a positive number/);
  });
});
