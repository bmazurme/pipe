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

  // Regression: an unknown flag (a typo, e.g. "--jsno") used to be silently
  // ignored, printing a plain-text report for what looked like a --json
  // request with no indication anything was wrong.
  it('rejects an unknown flag instead of silently ignoring it', () => {
    assert.throws(() => parseArgs(['--unknown', 'x', '--reports-state', '/d.json']), /Unknown option: --unknown/);
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

  it('parses --log <key>', () => {
    assert.equal(parseArgs(['--log', '402:6']).logKey, '402:6');
    assert.equal(parseArgs([]).logKey, undefined);
  });

  it('throws when --log is missing its key argument', () => {
    assert.throws(() => parseArgs(['--log']), /expects a task key/);
  });

  it('rejects a non-positive --watch value', () => {
    assert.throws(() => parseArgs(['--watch', '0']), /positive number of seconds/);
    assert.throws(() => parseArgs(['--watch', 'soon']), /positive number of seconds/);
  });

  it('parses --live, defaulting to false', () => {
    assert.equal(parseArgs(['--live']).live, true);
    assert.equal(parseArgs([]).live, false);
  });

  it('parses --notify', () => {
    assert.equal(parseArgs(['--notify']).notify, true);
    assert.equal(parseArgs([]).notify, false);
  });

  it('parses --pull/--retry/--publish into one action, plus --yes/--dry-run/--project/--reports-url', () => {
    assert.deepEqual(parseArgs(['--pull', '402:6']).action, { kind: 'pull', key: '402:6' });
    assert.deepEqual(parseArgs(['--retry', '402:6']).action, { kind: 'retry', key: '402:6' });
    assert.deepEqual(parseArgs(['--publish', '402:6']).action, { kind: 'publish', key: '402:6' });
    assert.equal(parseArgs([]).action, undefined);

    const options = parseArgs(['--pull', '402:6', '--yes', '--dry-run', '--project', 'bff', '--reports-url', 'http://x']);
    assert.equal(options.yes, true);
    assert.equal(options.dryRun, true);
    assert.equal(options.project, 'bff');
    assert.equal(options.reportsUrl, 'http://x');
  });

  it('rejects combining two action flags in the same invocation', () => {
    assert.throws(() => parseArgs(['--pull', '402:6', '--retry', '402:7']), /only one of --pull\/--retry\/--publish/);
  });

  it('throws when an action flag is missing its task key', () => {
    assert.throws(() => parseArgs(['--pull']), /expects a task key/);
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

  // IMPROVEMENTS_HARNESS.md 2.1 — a concrete next step, not just a label.
  it('prints a concrete next action for a task waiting to be published', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'harness-status-'));
    try {
      const paths = makeFixturePaths(dir);
      writeFileSync(paths.reportsState, JSON.stringify({
        '402:6': { step: 'pulled', pulledAt: '2026-09-28T09:00:00.000Z' },
      }));

      const report = buildReport(paths);

      assert.match(report, /next: publish the result \(reports → Subscription → Publish\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prints a runnable pull-issue command for a task pushed and waiting', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'harness-status-'));
    try {
      const paths = makeFixturePaths(dir);
      writeFileSync(paths.reportsState, JSON.stringify({
        '402:6': { step: 'pushed', pushedAt: '2026-09-28T09:00:00.000Z' },
      }));

      const report = buildReport(paths);

      assert.match(report, /next: pull the result once it is ready → sync-cli pull-issue <name> 402 6/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // IMPROVEMENTS_HARNESS.md 6.4 — "N ago" instead of an unactionable hash.
  it('shows "last synced N ago" instead of a raw hash once lastSyncedAt exists', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'harness-status-'));
    try {
      const paths = makeFixturePaths(dir);
      writeFileSync(paths.syncState, JSON.stringify({
        bridge: { lastHash: 'abc123def456', lastSyncedAt: new Date(Date.now() - 3 * HOUR).toISOString() },
        legacy: { lastHash: 'deadbeefcafe' },
      }));

      const report = buildReport(paths);

      assert.match(report, /bridge: last synced 3h ago/);
      assert.match(report, /legacy: lastHash deadbeefcafe… \(synced before timestamps were recorded\)/);
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

  // IMPROVEMENTS_HARNESS.md 6.3: 'init' has no step-specific timestamp of
  // its own (unlike pushed/pulled/published), so staleness falls back to
  // the entry's updatedAt — stamped by reports' setIssueState on every
  // write (state-props.ts).
  it('marks an init subscription stale once past the threshold, using updatedAt', () => {
    const fresh: TaskEntry = { key, subscription: { step: 'init', branch: 'b', updatedAt: new Date(NOW - 1 * HOUR).toISOString() } };
    const freshStatus = deriveStatus(fresh, 24, NOW);
    assert.equal(freshStatus.stale, false);
    assert.match(freshStatus.label, /not yet pushed/);

    const stale: TaskEntry = { key, subscription: { step: 'init', branch: 'b', updatedAt: new Date(NOW - 48 * HOUR).toISOString() } };
    const staleStatus = deriveStatus(stale, 24, NOW);
    assert.equal(staleStatus.stale, true);
    assert.match(staleStatus.label, /not yet pushed/);
  });

  it('never marks an init subscription stale when updatedAt is absent (an entry written before this field existed)', () => {
    const task: TaskEntry = { key, subscription: { step: 'init', branch: 'b' } };
    assert.equal(deriveStatus(task, 24, NOW).stale, false);
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

  // IMPROVEMENTS_HARNESS.md 2.1 — a concrete command where sync-cli can run
  // one by itself, no command where the real next step is a UI action
  // (reports' Publish) or there's simply nothing to do yet.
  describe('nextAction', () => {
    it('gives a pull-issue command for a pushed subscription', () => {
      const task: TaskEntry = { key, subscription: { step: 'pushed' } };
      assert.deepEqual(deriveStatus(task, 24, NOW).nextAction, {
        label: 'pull the result once it is ready',
        command: 'sync-cli pull-issue <name> 402 6',
      });
    });

    it('gives a push-issue command for an init subscription', () => {
      const task: TaskEntry = { key, subscription: { step: 'init' } };
      assert.deepEqual(deriveStatus(task, 24, NOW).nextAction, {
        label: 'push the issue to start the pipeline',
        command: 'sync-cli push-issue <name> 402 6',
      });
    });

    it('points at reports\' Publish action for a pulled subscription, with no command', () => {
      const task: TaskEntry = { key, subscription: { step: 'pulled' } };
      assert.deepEqual(deriveStatus(task, 24, NOW).nextAction, {
        label: 'publish the result (reports → Subscription → Publish)',
      });
    });

    it('omits nextAction for a done, non-failing published subscription', () => {
      const task: TaskEntry = { key, subscription: { step: 'published' } };
      assert.equal(deriveStatus(task, 24, NOW).nextAction, undefined);
    });

    it('points at the failing pipeline for a published subscription whose pipeline failed, with no command', () => {
      const task: TaskEntry = { key, subscription: { step: 'published' } };
      const status = deriveStatus(task, 24, NOW, undefined, {
        mergeRequest: { iid: 42, state: 'opened', pipelineStatus: 'failed' },
      });
      assert.deepEqual(status.nextAction, { label: 'investigate the failing pipeline for MR !42' });
    });

    it('gives a pull-issue command once bridge storage confirms a result', () => {
      const task: TaskEntry = {
        key,
        gitlabWorker: { pushedAt: new Date(NOW - 1 * HOUR).toISOString(), filename: 'x.zip' },
        syncAgent: { lastOwnOutputHash: 'abc123' },
      };
      const status = deriveStatus(task, 24, NOW, { hasResultInStorage: true });
      assert.deepEqual(status.nextAction, { label: 'pull the result', command: 'sync-cli pull-issue <name> 402 6' });
    });

    it('omits nextAction while bridge storage has no confirmed result yet', () => {
      const task: TaskEntry = {
        key,
        gitlabWorker: { pushedAt: new Date(NOW - 1 * HOUR).toISOString(), filename: 'x.zip' },
        syncAgent: { lastOwnOutputHash: 'abc123' },
      };
      const status = deriveStatus(task, 24, NOW, { hasResultInStorage: false });
      assert.equal(status.nextAction, undefined);
    });

    it('omits nextAction while only gitlab-worker has pushed (still waiting on another machine)', () => {
      const task: TaskEntry = { key, gitlabWorker: { pushedAt: new Date(NOW - 1 * HOUR).toISOString(), filename: 'x.zip' } };
      assert.equal(deriveStatus(task, 24, NOW).nextAction, undefined);
    });

    it('omits nextAction when there is no local state at all', () => {
      assert.equal(deriveStatus({ key }, 24, NOW).nextAction, undefined);
    });
  });

  // IMPROVEMENTS_HARNESS.md 1.1: with live data, "likely ready to pull"
  // becomes a fact one way or the other instead of a guess.
  it('upgrades "likely ready to pull" into a fact when live data is supplied', () => {
    const readyToPull: TaskEntry = {
      key,
      gitlabWorker: { pushedAt: new Date(NOW - 48 * HOUR).toISOString(), filename: 'x.zip' },
      syncAgent: { lastOwnOutputHash: 'abc123' },
    };

    const confirmed = deriveStatus(readyToPull, 24, NOW, { hasResultInStorage: true });
    assert.match(confirmed.label, /confirmed in bridge storage/);

    const notYet = deriveStatus(readyToPull, 24, NOW, { hasResultInStorage: false });
    assert.match(notYet.label, /no result yet/);
  });

  it('attaches the worker job status as liveNote regardless of which branch matched', () => {
    const task: TaskEntry = { key, subscription: { step: 'pushed', pushedAt: new Date(NOW - 1 * HOUR).toISOString() } };
    const live = {
      hasResultInStorage: false,
      job: { id: 42, status: 'running', model: 'gpt', errorMessage: null, createdAt: '', finishedAt: null },
    };

    const status = deriveStatus(task, 24, NOW, live);
    assert.match(status.liveNote ?? '', /worker job #42 \(gpt\): running/);
  });

  it('omits liveNote entirely (not just leaves it undefined) when there is no live job', () => {
    const task: TaskEntry = { key, subscription: { step: 'published' } };
    assert.deepEqual(deriveStatus(task, 24, NOW), { label: 'published — done', stale: false });
  });

  // IMPROVEMENTS_HARNESS.md 1.2: the one case this item exists for — a
  // "published — done" task whose MR's pipeline actually failed.
  describe('gitlabLive', () => {
    it('flags a published task as stale when its MR pipeline failed, instead of trusting "done"', () => {
      const task: TaskEntry = { key, subscription: { step: 'published' } };
      const status = deriveStatus(task, 24, NOW, undefined, {
        issueState: 'opened',
        mergeRequest: { iid: 42, state: 'opened', pipelineStatus: 'failed' },
      });

      assert.equal(status.stale, true);
      assert.match(status.label, /pipeline failed/);
      assert.match(status.label, /MR !42/);
    });

    it('leaves a published task alone when its pipeline succeeded', () => {
      const task: TaskEntry = { key, subscription: { step: 'published' } };
      const status = deriveStatus(task, 24, NOW, undefined, {
        issueState: 'closed',
        mergeRequest: { iid: 42, state: 'merged', pipelineStatus: 'success' },
      });

      assert.equal(status.stale, false);
      assert.equal(status.label, 'published — done');
    });

    it('attaches gitlabNote regardless of which branch matched, independent of bridge live data', () => {
      const task: TaskEntry = { key, subscription: { step: 'pushed', pushedAt: new Date(NOW - 1 * HOUR).toISOString() } };
      const status = deriveStatus(task, 24, NOW, undefined, {
        issueState: 'opened',
        mergeRequest: { iid: 7, state: 'opened', pipelineStatus: 'running' },
      });

      assert.match(status.gitlabNote ?? '', /issue opened/);
      assert.match(status.gitlabNote ?? '', /MR !7 \(opened\), pipeline running/);
    });

    it('notes "no MR for this branch yet" when the issue is known but has no MR', () => {
      const task: TaskEntry = { key, subscription: { step: 'pushed', pushedAt: new Date(NOW - 1 * HOUR).toISOString() } };
      const status = deriveStatus(task, 24, NOW, undefined, { issueState: 'opened' });

      assert.match(status.gitlabNote ?? '', /no MR for this branch yet/);
    });

    it('omits gitlabNote entirely when no GitLab live data was supplied', () => {
      const task: TaskEntry = { key, subscription: { step: 'published' } };
      assert.deepEqual(deriveStatus(task, 24, NOW), { label: 'published — done', stale: false });
    });
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
