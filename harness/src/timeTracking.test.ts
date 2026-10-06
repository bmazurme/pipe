import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { formatGitlabDuration, proposeTimeEntry, logTime, type LogTimeDeps } from './timeTracking.js';

describe('formatGitlabDuration', () => {
  it('formats a whole number of hours with no minutes', () => {
    assert.equal(formatGitlabDuration(2), '2h');
  });

  it('formats a sub-hour duration as minutes only', () => {
    assert.equal(formatGitlabDuration(0.5), '30m');
  });

  it('formats a mixed hours+minutes duration', () => {
    assert.equal(formatGitlabDuration(2.5), '2h30m');
  });

  it('rounds to the nearest minute', () => {
    assert.equal(formatGitlabDuration(1.004), '1h');
  });

  it('never returns a zero duration — GitLab rejects it', () => {
    assert.equal(formatGitlabDuration(0), '1m');
  });
});

describe('proposeTimeEntry', () => {
  it('proposes a draft when pulledAt is after pushedAt', () => {
    const draft = proposeTimeEntry({ pushedAt: '2026-10-05T10:00:00.000Z', pulledAt: '2026-10-05T12:30:00.000Z' }, '402:6');
    assert.ok(draft);
    assert.equal(draft?.duration, '2h30m');
    assert.equal(draft?.key, '402:6');
  });

  it('returns undefined when either timestamp is missing', () => {
    assert.equal(proposeTimeEntry({ pushedAt: '2026-10-05T10:00:00.000Z' }, '402:6'), undefined);
    assert.equal(proposeTimeEntry({ pulledAt: '2026-10-05T10:00:00.000Z' }, '402:6'), undefined);
    assert.equal(proposeTimeEntry(undefined, '402:6'), undefined);
  });

  it('returns undefined when pulledAt predates pushedAt — a newer push since the last pull, nothing completed since', () => {
    const draft = proposeTimeEntry({ pushedAt: '2026-10-05T18:30:00.000Z', pulledAt: '2026-10-05T18:21:00.000Z' }, '402:6');
    assert.equal(draft, undefined);
  });

  it('returns undefined when pulledAt equals pushedAt', () => {
    const draft = proposeTimeEntry({ pushedAt: '2026-10-05T10:00:00.000Z', pulledAt: '2026-10-05T10:00:00.000Z' }, '402:6');
    assert.equal(draft, undefined);
  });
});

function makeDeps(overrides: Partial<LogTimeDeps> = {}): LogTimeDeps & { calls: { addSpentTime: unknown[][] } } {
  const calls = { addSpentTime: [] as unknown[][] };
  const deps: LogTimeDeps = {
    loadGitlabConfig: () => ({ apiUrl: 'https://gitlab.example.com/api/v4', token: 'tok' }),
    addSpentTime: async (...args: unknown[]) => {
      calls.addSpentTime.push(args);
    },
    confirm: async () => true,
    isInteractive: true,
    ...overrides,
  };
  return Object.assign(deps, { calls });
}

describe('logTime', () => {
  let dir: string;

  function withState(entry: Record<string, unknown>): { reportsState: string } {
    dir = mkdtempSync(path.join(tmpdir(), 'harness-timetracking-test-'));
    const reportsState = path.join(dir, 'subscription-state.json');
    writeFileSync(reportsState, JSON.stringify(entry));
    return { reportsState };
  }

  function cleanup(): void {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }

  it('rejects a malformed task key without touching any dependency', async () => {
    const deps = makeDeps();
    const result = await logTime('not-a-key', { yes: true, dryRun: false }, deps);

    assert.equal(result.code, 1);
    assert.match(result.output, /Invalid task key/);
    assert.equal(deps.calls.addSpentTime.length, 0);
  });

  it('reports nothing to propose when there is no completed push→pull cycle on record', async () => {
    const paths = withState({});
    try {
      const deps = makeDeps();
      const result = await logTime('402:6', { yes: true, dryRun: false, paths }, deps);

      assert.equal(result.code, 1);
      assert.match(result.output, /nothing to propose/);
      assert.equal(deps.calls.addSpentTime.length, 0);
    } finally {
      cleanup();
    }
  });

  it('dry-run describes the proposed entry and logs nothing', async () => {
    const paths = withState({
      '402:6': { step: 'pulled', pushedAt: '2026-10-05T10:00:00.000Z', pulledAt: '2026-10-05T12:30:00.000Z' },
    });
    try {
      const deps = makeDeps();
      const result = await logTime('402:6', { yes: false, dryRun: true, paths }, deps);

      assert.equal(result.code, 0);
      assert.match(result.output, /Would log 2h30m spent on 402:6/);
      assert.equal(deps.calls.addSpentTime.length, 0);
    } finally {
      cleanup();
    }
  });

  it('refuses to proceed non-interactively without --yes', async () => {
    const paths = withState({
      '402:6': { step: 'pulled', pushedAt: '2026-10-05T10:00:00.000Z', pulledAt: '2026-10-05T12:30:00.000Z' },
    });
    try {
      const deps = makeDeps({ isInteractive: false });
      const result = await logTime('402:6', { yes: false, dryRun: false, paths }, deps);

      assert.equal(result.code, 1);
      assert.match(result.output, /without confirmation/);
      assert.equal(deps.calls.addSpentTime.length, 0);
    } finally {
      cleanup();
    }
  });

  it('aborts when the interactive confirmation is declined', async () => {
    const paths = withState({
      '402:6': { step: 'pulled', pushedAt: '2026-10-05T10:00:00.000Z', pulledAt: '2026-10-05T12:30:00.000Z' },
    });
    try {
      const deps = makeDeps({ confirm: async () => false });
      const result = await logTime('402:6', { yes: false, dryRun: false, paths }, deps);

      assert.equal(result.code, 1);
      assert.match(result.output, /Aborted/);
      assert.equal(deps.calls.addSpentTime.length, 0);
    } finally {
      cleanup();
    }
  });

  it('skips the interactive prompt and logs when --yes is given', async () => {
    const paths = withState({
      '402:6': { step: 'pulled', pushedAt: '2026-10-05T10:00:00.000Z', pulledAt: '2026-10-05T12:30:00.000Z' },
    });
    try {
      const deps = makeDeps({
        confirm: async () => {
          throw new Error('should not prompt when --yes is given');
        },
      });
      const result = await logTime('402:6', { yes: true, dryRun: false, paths }, deps);

      assert.equal(result.code, 0);
      assert.match(result.output, /Logged 2h30m on 402:6/);
      assert.deepEqual(deps.calls.addSpentTime[0], ['https://gitlab.example.com/api/v4', 'tok', '402', '6', '2h30m']);
    } finally {
      cleanup();
    }
  });

  it('reports a failure to find a GitLab config without logging anything', async () => {
    const paths = withState({
      '402:6': { step: 'pulled', pushedAt: '2026-10-05T10:00:00.000Z', pulledAt: '2026-10-05T12:30:00.000Z' },
    });
    try {
      const deps = makeDeps({ loadGitlabConfig: () => undefined });
      const result = await logTime('402:6', { yes: true, dryRun: false, paths }, deps);

      assert.equal(result.code, 1);
      assert.match(result.output, /no GitLab token configured/);
      assert.equal(deps.calls.addSpentTime.length, 0);
    } finally {
      cleanup();
    }
  });

  it('propagates an error thrown by addSpentTime', async () => {
    const paths = withState({
      '402:6': { step: 'pulled', pushedAt: '2026-10-05T10:00:00.000Z', pulledAt: '2026-10-05T12:30:00.000Z' },
    });
    try {
      const deps = makeDeps({
        addSpentTime: async () => {
          throw new Error('GitLab API returned 404');
        },
      });
      const result = await logTime('402:6', { yes: true, dryRun: false, paths }, deps);

      assert.equal(result.code, 1);
      assert.match(result.output, /GitLab API returned 404/);
    } finally {
      cleanup();
    }
  });
});
