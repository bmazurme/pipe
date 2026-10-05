import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { describeSignature, formatTransitionNotification } from './notifyTransitions.js';
import type { TaskEvent } from './events.js';

describe('describeSignature', () => {
  it('turns a subscription signature into "reports: <step>"', () => {
    assert.equal(describeSignature('subscription:pulled'), 'reports: pulled');
  });

  it('has a readable label for every non-subscription signature taskSignature() produces', () => {
    assert.equal(describeSignature('no-local-state'), 'no local state');
    assert.equal(describeSignature('gitlab-worker'), 'pushed to bridge, waiting on agent-runner');
    assert.equal(describeSignature('gitlab-worker+agent-runner'), 'agent-runner result pushed, likely ready to pull');
    assert.equal(describeSignature('agent-runner'), 'agent-runner result pushed (no gitlab-worker record)');
  });

  it('falls back to the raw signature for anything unrecognized, rather than throwing', () => {
    assert.equal(describeSignature('something-new'), 'something-new');
  });
});

describe('formatTransitionNotification', () => {
  it('uses the task key as the title and a readable from → to as the message', () => {
    const event: TaskEvent = {
      ts: '2026-10-05T14:34:12.663Z',
      key: '123:m-abc',
      source: 'reports (subscription)',
      from: 'subscription:pushed',
      to: 'subscription:pulled',
    };

    assert.deepEqual(formatTransitionNotification(event), {
      title: '123:m-abc',
      message: 'reports: pushed → reports: pulled',
    });
  });
});
