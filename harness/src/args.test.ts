import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { HELP_TEXT, parseArgs } from './args.js';

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

  it('parses --next', () => {
    assert.equal(parseArgs(['--next']).next, true);
    assert.equal(parseArgs([]).next, false);
  });

  it('parses --brief and --recent-hours', () => {
    assert.equal(parseArgs(['--brief']).brief, true);
    assert.equal(parseArgs([]).brief, false);
    assert.equal(parseArgs(['--brief', '--recent-hours', '48']).recentHours, 48);
    assert.equal(parseArgs([]).recentHours, undefined);
  });

  it('rejects a non-positive --recent-hours value', () => {
    assert.throws(() => parseArgs(['--recent-hours', '0']), /positive number of hours/);
    assert.throws(() => parseArgs(['--recent-hours', 'soon']), /positive number of hours/);
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

describe('HELP_TEXT', () => {
  it('documents the usage line and the defaults', () => {
    assert.match(HELP_TEXT, /^pipe-status/);
    assert.match(HELP_TEXT, /--stale-after/);
  });
});
