import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildTaskChoices } from './tui.js';

describe('buildTaskChoices', () => {
  it('formats a runnable item with its command as the hint', () => {
    const choices = buildTaskChoices([
      {
        key: '402:6',
        bucket: 'stale',
        label: 'pushed 2026-09-26T10:00:00.000Z — no pull since',
        nextAction: { label: 'pull the result once it is ready', command: 'sync-cli pull-issue <name> 402 6', actionKind: 'pull' },
      },
    ]);

    assert.deepEqual(choices, [
      {
        value: '402:6',
        label: '[stale] 402:6 — pushed 2026-09-26T10:00:00.000Z — no pull since',
        hint: 'sync-cli pull-issue <name> 402 6',
      },
    ]);
  });

  it('falls back to the next action\'s label as the hint when there is no command (e.g. publish)', () => {
    const choices = buildTaskChoices([
      {
        key: '402:6',
        bucket: 'ready',
        label: 'pulled — ready to publish',
        nextAction: { label: 'publish the result (reports → Subscription → Publish)', actionKind: 'publish' },
      },
    ]);

    assert.equal(choices[0].hint, 'publish the result (reports → Subscription → Publish)');
  });

  it('shows "nothing to do yet" for a stale task with no next action at all', () => {
    const choices = buildTaskChoices([
      { key: '402:6', bucket: 'stale', label: 'pushed to bridge — still waiting on agent-runner' },
    ]);

    assert.equal(choices[0].hint, 'nothing to do yet');
  });

  it('preserves ranking order and maps one-to-one', () => {
    const choices = buildTaskChoices([
      { key: '1:1', bucket: 'stale', label: 'a' },
      { key: '1:2', bucket: 'ready', label: 'b', nextAction: { label: 'c', actionKind: 'publish' } },
    ]);

    assert.deepEqual(choices.map((c) => c.value), ['1:1', '1:2']);
  });
});
