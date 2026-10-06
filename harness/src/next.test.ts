import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { TaskEntry } from './collect.js';
import { annotateTasks } from './deriveStatus.js';
import { pickNextTask, rankTasks } from './next.js';

const NOW = Date.parse('2026-10-05T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

describe('pickNextTask', () => {
  it('picks a stale task over everything else', () => {
    const tasks: TaskEntry[] = [
      { key: '1:1', subscription: { step: 'pulled', pulledAt: new Date(NOW).toISOString() } }, // confirmed-ready
      { key: '1:2', subscription: { step: 'pushed', pushedAt: new Date(NOW - 48 * HOUR).toISOString() } }, // stale
    ];
    const annotated = annotateTasks(tasks, 24, NOW);

    const picked = pickNextTask(annotated);
    assert.equal(picked?.key, '1:2');
    assert.equal(picked?.bucket, 'stale');
  });

  it('picks a confirmed-ready task (pulled, awaiting publish) over an incoming or in-progress one', () => {
    const tasks: TaskEntry[] = [
      { key: '1:1', subscription: { step: 'pulled' } },
      { key: '1:2', subscription: { step: 'init' } },
    ];
    const annotated = annotateTasks(tasks, 24, NOW);

    const picked = pickNextTask(annotated, [{ key: '1:0', projectId: 1, iid: 0, title: 'New issue' }]);
    assert.equal(picked?.key, '1:1');
    assert.equal(picked?.bucket, 'ready');
    assert.deepEqual(picked?.nextAction, { label: 'publish the result (reports → Subscription → Publish)', actionKind: 'publish' });
  });

  it('treats a gitlab-worker+agent-runner task as confirmed-ready only once --live confirms it', () => {
    const tasks: TaskEntry[] = [
      {
        key: '1:1',
        gitlabWorker: { pushedAt: new Date(NOW - 1 * HOUR).toISOString(), filename: 'x.zip' },
        syncAgent: { lastOwnOutputHash: 'abc' },
      },
    ];
    const annotated = annotateTasks(tasks, 24, NOW);

    const withoutLive = pickNextTask(annotated);
    assert.equal(withoutLive?.bucket, 'other');

    const liveTasks = new Map([['1:1', { hasResultInStorage: true }]]);
    const withLive = pickNextTask(annotated, [], liveTasks);
    assert.equal(withLive?.bucket, 'ready');
  });

  it('picks an incoming (newly assigned, not yet pushed) issue over an in-progress task', () => {
    const tasks: TaskEntry[] = [{ key: '2:9', subscription: { step: 'init' } }];
    const annotated = annotateTasks(tasks, 24, NOW);

    const picked = pickNextTask(annotated, [{ key: '1:5', projectId: 1, iid: 5, title: 'Fix the thing' }]);
    assert.equal(picked?.key, '1:5');
    assert.equal(picked?.bucket, 'incoming');
    assert.match(picked?.label ?? '', /Fix the thing/);
    assert.equal(picked?.nextAction?.command, 'sync-cli push-issue <name> 1 5');
  });

  it('falls back to any in-progress task with a next action when nothing more urgent exists', () => {
    const tasks: TaskEntry[] = [{ key: '2:9', subscription: { step: 'init' } }];
    const annotated = annotateTasks(tasks, 24, NOW);

    const picked = pickNextTask(annotated);
    assert.equal(picked?.key, '2:9');
    assert.equal(picked?.bucket, 'other');
  });

  it('returns undefined when there is nothing to recommend', () => {
    const tasks: TaskEntry[] = [
      { key: '1:1', subscription: { step: 'published' } }, // done, no nextAction
      { key: '1:2' }, // no local state, no nextAction
    ];
    const annotated = annotateTasks(tasks, 24, NOW);

    assert.equal(pickNextTask(annotated), undefined);
  });

  it('breaks ties within a bucket by the lower project:iid key', () => {
    const tasks: TaskEntry[] = [
      { key: '9:1', subscription: { step: 'pulled' } },
      { key: '2:1', subscription: { step: 'pulled' } },
    ];
    const annotated = annotateTasks(tasks, 24, NOW);

    assert.equal(pickNextTask(annotated)?.key, '2:1');
  });
});

describe('rankTasks', () => {
  it('lists every task once, in bucket-priority order', () => {
    const tasks: TaskEntry[] = [
      { key: '1:1', subscription: { step: 'pushed', pushedAt: new Date(NOW - 48 * HOUR).toISOString() } }, // stale
      { key: '1:2', subscription: { step: 'pulled' } }, // ready
      { key: '1:3', subscription: { step: 'init' } }, // other
    ];
    const annotated = annotateTasks(tasks, 24, NOW);

    const ranked = rankTasks(annotated, [{ key: '1:0', projectId: 1, iid: 0, title: 'New issue' }]);

    assert.deepEqual(
      ranked.map((item) => [item.key, item.bucket]),
      [
        ['1:1', 'stale'],
        ['1:2', 'ready'],
        ['1:0', 'incoming'],
        ['1:3', 'other'],
      ],
    );
  });

  it('places a task that is both stale and confirmed-ready under stale only, not twice', () => {
    const tasks: TaskEntry[] = [
      { key: '1:1', subscription: { step: 'pulled', pulledAt: new Date(NOW - 48 * HOUR).toISOString() } },
    ];
    const annotated = annotateTasks(tasks, 24, NOW);

    const ranked = rankTasks(annotated);
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].bucket, 'stale');
  });

  it('omits a task with no next action at all from the ranking entirely', () => {
    const tasks: TaskEntry[] = [{ key: '1:1', subscription: { step: 'published' } }];
    const annotated = annotateTasks(tasks, 24, NOW);

    assert.deepEqual(rankTasks(annotated), []);
  });
});
