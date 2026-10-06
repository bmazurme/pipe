import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { recordTransitions, readRecentEvents, readTaskEvents, type EventsPaths } from './events.js';
import type { TaskEntry } from './collect.js';

let dir: string;
let paths: EventsPaths;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'harness-events-test-'));
  paths = { log: path.join(dir, 'events.jsonl'), snapshot: path.join(dir, 'last-snapshot.json') };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const NOW = () => '2026-10-05T12:00:00.000Z';

describe('recordTransitions', () => {
  it('records nothing on the very first observation of a task (no prior snapshot to diff against)', () => {
    const tasks: TaskEntry[] = [{ key: '402:6', subscription: { step: 'init' } }];

    const events = recordTransitions(tasks, paths, NOW);

    assert.deepEqual(events, []);
    assert.equal(existsSync(paths.log), false);
  });

  it('records a transition when a task\'s underlying signal changes between two runs', () => {
    const pushed: TaskEntry = { key: '402:6', subscription: { step: 'init' } };
    recordTransitions([pushed], paths, NOW);

    const next: TaskEntry = { key: '402:6', subscription: { step: 'pushed', pushedAt: NOW() } };
    const events = recordTransitions([next], paths, NOW);

    assert.deepEqual(events, [
      { ts: NOW(), key: '402:6', source: 'reports (subscription)', from: 'subscription:init', to: 'subscription:pushed' },
    ]);

    const logged = readFileSync(paths.log, 'utf-8').trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(logged, events);
  });

  it('records nothing when the underlying signal is unchanged, even if the derived label would differ (e.g. staleness wording)', () => {
    const task: TaskEntry = { key: '402:6', subscription: { step: 'pushed', pushedAt: '2020-01-01T00:00:00.000Z' } };
    recordTransitions([task], paths, NOW);

    // Same step, just "later" — a real deriveStatus() call for this would
    // now render the [stale] wording, but the underlying signal (step)
    // hasn't actually changed.
    const events = recordTransitions([task], paths, NOW);

    assert.deepEqual(events, []);
  });

  it('distinguishes gitlab-worker-only, agent-runner-only, and both-present signatures', () => {
    const key = '402:6';
    recordTransitions([{ key, gitlabWorker: { pushedAt: NOW(), filename: 'x.zip' } }], paths, NOW);

    const events = recordTransitions(
      [{ key, gitlabWorker: { pushedAt: NOW(), filename: 'x.zip' }, syncAgent: { lastOwnOutputHash: 'abc' } }],
      paths,
      NOW,
    );

    assert.deepEqual(events, [
      { ts: NOW(), key, source: 'sync (agent-runner)', from: 'gitlab-worker', to: 'gitlab-worker+agent-runner' },
    ]);
  });

  it('does not record a transition for a task whose signature is unchanged across many tasks', () => {
    const tasks: TaskEntry[] = [
      { key: '1:1', subscription: { step: 'init' } },
      { key: '1:2', subscription: { step: 'pushed', pushedAt: NOW() } },
    ];
    recordTransitions(tasks, paths, NOW);

    const changedOnlyFirst: TaskEntry[] = [
      { key: '1:1', subscription: { step: 'pushed', pushedAt: NOW() } },
      { key: '1:2', subscription: { step: 'pushed', pushedAt: NOW() } },
    ];
    const events = recordTransitions(changedOnlyFirst, paths, NOW);

    assert.equal(events.length, 1);
    assert.equal(events[0].key, '1:1');
  });

  it('tolerates a missing or corrupted snapshot file instead of throwing', () => {
    rmSync(paths.snapshot, { force: true });
    const tasks: TaskEntry[] = [{ key: '402:6', subscription: { step: 'init' } }];

    assert.doesNotThrow(() => recordTransitions(tasks, paths, NOW));
  });
});

describe('readTaskEvents', () => {
  it('returns an empty array when nothing has ever been logged', () => {
    assert.deepEqual(readTaskEvents('402:6', paths), []);
  });

  it('returns only the events for the requested key, in log order', () => {
    recordTransitions([{ key: '402:6', subscription: { step: 'init' } }], paths, NOW);
    recordTransitions([{ key: '402:6', subscription: { step: 'pushed', pushedAt: NOW() } }], paths, NOW);
    recordTransitions([{ key: '402:7', subscription: { step: 'init' } }], paths, NOW);
    recordTransitions([{ key: '402:7', subscription: { step: 'pushed', pushedAt: NOW() } }], paths, NOW);
    recordTransitions([{ key: '402:6', subscription: { step: 'pulled', pulledAt: NOW() } }], paths, NOW);

    const events = readTaskEvents('402:6', paths);

    assert.equal(events.length, 2);
    assert.deepEqual(events.map((e) => e.to), ['subscription:pushed', 'subscription:pulled']);
  });
});

// IMPROVEMENTS_HARNESS.md 3.2 — the brief's own "moved recently" section.
describe('readRecentEvents', () => {
  const HOUR = 60 * 60 * 1000;
  const REF_NOW = Date.parse('2026-10-05T12:00:00.000Z');

  it('returns events from every key, not just one, within the window', () => {
    recordTransitions([{ key: '1:1', subscription: { step: 'init' } }], paths, () => new Date(REF_NOW - 48 * HOUR).toISOString());
    recordTransitions([{ key: '1:1', subscription: { step: 'pushed', pushedAt: NOW() } }], paths, () => new Date(REF_NOW - 1 * HOUR).toISOString());
    recordTransitions([{ key: '1:2', subscription: { step: 'init' } }], paths, () => new Date(REF_NOW - 48 * HOUR).toISOString());
    recordTransitions([{ key: '1:2', subscription: { step: 'pushed', pushedAt: NOW() } }], paths, () => new Date(REF_NOW - 2 * HOUR).toISOString());

    const events = readRecentEvents(24, REF_NOW, paths);

    assert.deepEqual(events.map((e) => e.key), ['1:1', '1:2']);
  });

  it('excludes events older than the window', () => {
    recordTransitions([{ key: '1:1', subscription: { step: 'init' } }], paths, () => new Date(REF_NOW - 48 * HOUR).toISOString());
    recordTransitions([{ key: '1:1', subscription: { step: 'pushed', pushedAt: NOW() } }], paths, () => new Date(REF_NOW - 30 * HOUR).toISOString());

    assert.deepEqual(readRecentEvents(24, REF_NOW, paths), []);
  });

  it('returns an empty array when nothing has ever been logged', () => {
    assert.deepEqual(readRecentEvents(24, REF_NOW, paths), []);
  });
});
