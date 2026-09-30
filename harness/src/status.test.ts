import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  annotateTasks,
  buildReport,
  collectReportData,
  compareIssueKeys,
  deriveStatus,
  exitCodeFor,
  filterReportData,
  parseArgs,
  type StatusPaths,
  type TaskEntry,
} from './status.js';

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-09-30T12:00:00.000Z');

function makeFixturePaths(dir: string): StatusPaths {
  return {
    syncState: path.join(dir, 'sync-state.json'),
    syncAgentState: path.join(dir, 'sync-agent-state.json'),
    gitlabWorkerState: path.join(dir, 'gitlab-worker-state.json'),
    reportsState: path.join(dir, 'reports-state.json'),
  };
}

describe('compareIssueKeys', () => {
  it('sorts multi-digit ids numerically, not lexicographically', () => {
    assert.deepEqual(['173:628', '2:5'].sort(compareIssueKeys), ['2:5', '173:628']);
  });

  it('sorts by project first, then by iid', () => {
    assert.deepEqual(['402:10', '402:2', '5:1'].sort(compareIssueKeys), ['5:1', '402:2', '402:10']);
  });

  it('falls back to string comparison for a non-numeric segment (manual entries)', () => {
    assert.deepEqual(['999:m-b', '999:5', '999:m-a'].sort(compareIssueKeys), ['999:5', '999:m-a', '999:m-b']);
  });
});

describe('parseArgs', () => {
  it('maps each flag to its StatusPaths key', () => {
    const options = parseArgs([
      '--sync-state', '/a.json',
      '--sync-agent-state', '/b.json',
      '--gitlab-worker-state', '/c.json',
      '--reports-state', '/d.json',
    ]);

    assert.deepEqual(options.paths, {
      syncState: '/a.json',
      syncAgentState: '/b.json',
      gitlabWorkerState: '/c.json',
      reportsState: '/d.json',
    });
  });

  it('ignores unknown flags and leaves unspecified paths out of the result', () => {
    assert.deepEqual(parseArgs(['--unknown', 'x', '--reports-state', '/d.json']).paths, { reportsState: '/d.json' });
  });

  it('throws when a known flag is missing its path argument', () => {
    assert.throws(() => parseArgs(['--sync-state']), /expects a path argument/);
  });

  it('parses --json, --filter and --watch', () => {
    const options = parseArgs(['--json', '--filter', '402:6', '--watch', '30']);

    assert.equal(options.json, true);
    assert.equal(options.filter, '402:6');
    assert.equal(options.watchSeconds, 30);
  });

  it('parses -h/--help', () => {
    assert.equal(parseArgs(['--help']).help, true);
    assert.equal(parseArgs(['-h']).help, true);
    assert.equal(parseArgs([]).help, false);
  });

  it('rejects a non-positive --watch value', () => {
    assert.throws(() => parseArgs(['--watch', '0']), /positive number of seconds/);
    assert.throws(() => parseArgs(['--watch', 'soon']), /positive number of seconds/);
  });
});

describe('buildReport', () => {
  let dir: string;

  it('reports "no state" for every section when nothing exists', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'harness-status-'));
    try {
      const report = buildReport(makeFixturePaths(dir));

      assert.match(report, /no state yet/);
      assert.match(report, /no in-flight tasks/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('surfaces a malformed state file as a clear message instead of throwing', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'harness-status-'));
    try {
      const paths = makeFixturePaths(dir);
      writeFileSync(paths.syncAgentState, '{ not valid json');

      const report = buildReport(paths);

      assert.match(report, /state file at .*sync-agent-state\.json is malformed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('merges gitlab-worker, sync agent, and reports subscription state under one key', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'harness-status-'));
    try {
      const paths = makeFixturePaths(dir);
      writeFileSync(paths.gitlabWorkerState, JSON.stringify({
        '402:6': { pushedAt: '2026-09-28T10:00:00.000Z', filename: '402-6.subscription.zip.enc' },
      }));
      writeFileSync(paths.syncAgentState, JSON.stringify({
        '402:6': { lastOwnOutputHash: 'abcdef0123456789' },
      }));
      writeFileSync(paths.reportsState, JSON.stringify({
        '402:6': { step: 'pulled', branch: 'b-mazur-30.09.2026-6', pushedAt: '2026-09-28T09:00:00.000Z' },
      }));

      const report = buildReport(paths);

      assert.match(report, /402:6:/);
      assert.match(report, /gitlab-worker: pushed 2026-09-28T10:00:00\.000Z as 402-6\.subscription\.zip\.enc/);
      assert.match(report, /sync \(agent-runner\): last own output abcdef012345…/);
      assert.match(report, /reports \(subscription\): step pulled, branch b-mazur-30\.09\.2026-6, pushed 2026-09-28T09:00:00\.000Z/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('labels a manual entry with its title and shows publishedAt/encrypted', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'harness-status-'));
    try {
      const paths = makeFixturePaths(dir);
      writeFileSync(paths.reportsState, JSON.stringify({
        '999:m-mulfq4ik': {
          step: 'published',
          manual: true,
          title: 'Тестовая посылка',
          publishedAt: '2026-09-28T19:00:00.000Z',
          encrypted: true,
        },
      }));

      const report = buildReport(paths);

      assert.match(report, /\[вручную\] "Тестовая посылка"/);
      assert.match(report, /published 2026-09-28T19:00:00\.000Z/);
      assert.match(report, /encrypted/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('filterReportData', () => {
  const data = {
    errors: [],
    syncState: {},
    tasks: [
      { key: '402:6' },
      { key: '402:7' },
      { key: '5:1' },
    ],
  };

  it('returns everything when no filter is given', () => {
    assert.equal(filterReportData(data, undefined).tasks.length, 3);
  });

  it('scopes to one project when given a bare projectId', () => {
    assert.deepEqual(filterReportData(data, '402').tasks.map((t) => t.key), ['402:6', '402:7']);
  });

  it('scopes to exactly one issue when given projectId:iid', () => {
    assert.deepEqual(filterReportData(data, '402:6').tasks.map((t) => t.key), ['402:6']);
  });

  it('returns no tasks for a filter that matches nothing', () => {
    assert.deepEqual(filterReportData(data, '999').tasks, []);
  });
});

describe('exitCodeFor', () => {
  it('is 0 when there are no errors', () => {
    assert.equal(exitCodeFor({ errors: [], syncState: {}, tasks: [] }), 0);
  });

  it('is 1 when a state file failed to parse', () => {
    assert.equal(exitCodeFor({ errors: ['state file at x is malformed: bad'], syncState: {}, tasks: [] }), 1);
  });
});

describe('collectReportData + JSON shape', () => {
  it('round-trips through JSON.stringify with the same shape --json prints', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'harness-status-'));
    try {
      const paths = makeFixturePaths(dir);
      writeFileSync(paths.reportsState, JSON.stringify({ '402:6': { step: 'pulled' } }));

      const data = collectReportData(paths);
      // JSON.stringify drops keys whose value is `undefined` (gitlabWorker/
      // syncAgent on a task with only reports-side state) — so this checks
      // the fields --json actually prints survive the round trip, not full
      // structural equality with the in-memory object.
      const parsed = JSON.parse(JSON.stringify(data));

      assert.equal(parsed.errors.length, 0);
      assert.equal(parsed.tasks.length, 1);
      assert.equal(parsed.tasks[0].key, '402:6');
      assert.equal(parsed.tasks[0].subscription?.step, 'pulled');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('deriveStatus', () => {
  const key = '402:6';

  it('labels a published subscription as done, never stale', () => {
    const task: TaskEntry = { key, subscription: { step: 'published' } };
    assert.deepEqual(deriveStatus(task, 24, NOW), { label: 'published — done', stale: false });
  });

  it('labels a fresh pushed subscription as waiting to be pulled', () => {
    const task: TaskEntry = { key, subscription: { step: 'pushed', pushedAt: new Date(NOW - 1 * HOUR).toISOString() } };
    const status = deriveStatus(task, 24, NOW);
    assert.equal(status.stale, false);
    assert.match(status.label, /waiting to be pulled/);
  });

  it('marks a pushed subscription stale once past the threshold', () => {
    const task: TaskEntry = { key, subscription: { step: 'pushed', pushedAt: new Date(NOW - 48 * HOUR).toISOString() } };
    const status = deriveStatus(task, 24, NOW);
    assert.equal(status.stale, true);
    assert.match(status.label, /no pull since/);
  });

  it('marks a pulled subscription stale once past the threshold', () => {
    const task: TaskEntry = { key, subscription: { step: 'pulled', pulledAt: new Date(NOW - 48 * HOUR).toISOString() } };
    const status = deriveStatus(task, 24, NOW);
    assert.equal(status.stale, true);
    assert.match(status.label, /not yet published/);
  });

  it('falls back to gitlab-worker + sync-agent signals when there is no reports state', () => {
    const waiting: TaskEntry = { key, gitlabWorker: { pushedAt: new Date(NOW - 1 * HOUR).toISOString(), filename: 'x.zip' } };
    assert.match(deriveStatus(waiting, 24, NOW).label, /waiting on agent-runner/);
    assert.equal(deriveStatus(waiting, 24, NOW).stale, false);

    const staleWaiting: TaskEntry = { key, gitlabWorker: { pushedAt: new Date(NOW - 48 * HOUR).toISOString(), filename: 'x.zip' } };
    assert.equal(deriveStatus(staleWaiting, 24, NOW).stale, true);

    const readyToPull: TaskEntry = {
      key,
      gitlabWorker: { pushedAt: new Date(NOW - 48 * HOUR).toISOString(), filename: 'x.zip' },
      syncAgent: { lastOwnOutputHash: 'abc123' },
    };
    const status = deriveStatus(readyToPull, 24, NOW);
    assert.match(status.label, /ready to pull/);
    assert.equal(status.stale, false);
  });

  it('reports "no local state" when nothing is present at all', () => {
    assert.deepEqual(deriveStatus({ key }, 24, NOW), { label: 'no local state', stale: false });
  });
});

describe('annotateTasks', () => {
  it('attaches a status to every task using the same now/threshold', () => {
    const tasks: TaskEntry[] = [{ key: '1:1', subscription: { step: 'published' } }, { key: '1:2' }];
    const annotated = annotateTasks(tasks, 24, NOW);

    assert.equal(annotated[0].status.label, 'published — done');
    assert.equal(annotated[1].status.label, 'no local state');
  });
});

describe('exitCodeFor with staleness', () => {
  it('is 1 when a task is stale even with no errors', () => {
    const data = {
      errors: [],
      syncState: {},
      tasks: [{ key: '1:1', status: { label: 'stale thing', stale: true } }],
    };
    assert.equal(exitCodeFor(data), 1);
  });

  it('is 0 when nothing is stale and there are no errors', () => {
    const data = {
      errors: [],
      syncState: {},
      tasks: [{ key: '1:1', status: { label: 'fine', stale: false } }],
    };
    assert.equal(exitCodeFor(data), 0);
  });
});
