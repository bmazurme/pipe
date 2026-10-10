import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { fetchGitlabLiveStatus, loadGitlabLiveConfig, resolveTaskBranch, settleWithLimit, type GitlabLiveConfigPaths } from './gitlabLive.js';
import type { TaskEntry } from './collect.js';

function makeConfigPaths(dir: string): GitlabLiveConfigPaths {
  return {
    syncCredentials: path.join(dir, 'credentials.json'),
    syncConfig: path.join(dir, 'config.json'),
  };
}

describe('resolveTaskBranch', () => {
  it('prefers reports\' own subscription.branch when present', () => {
    const task: TaskEntry = { key: '402:6', subscription: { step: 'pushed', branch: 'mazur-402-6' } };
    assert.equal(resolveTaskBranch(task), 'mazur-402-6');
  });

  it('falls back to gitlab-worker\'s synthetic branch naming when only that signal is present', () => {
    const task: TaskEntry = { key: '402:6', gitlabWorker: { pushedAt: '2026-10-01T00:00:00.000Z', filename: 'x.zip' } };
    assert.equal(resolveTaskBranch(task), 'task/402-6');
  });

  it('is undefined when there\'s no signal to derive a branch from at all', () => {
    const task: TaskEntry = { key: '402:6', syncAgent: { lastOwnOutputHash: 'abc' } };
    assert.equal(resolveTaskBranch(task), undefined);
  });
});

describe('settleWithLimit', () => {
  it('never runs more than `limit` calls at once, and keeps the order of the items', async () => {
    let inFlight = 0;
    let peak = 0;

    const results = await settleWithLimit([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      if (item === 4) throw new Error('boom');
      return item * 2;
    });

    assert.equal(peak, 3);
    assert.equal(results.length, 10);
    assert.deepEqual(results[0], { status: 'fulfilled', value: 2 });
    assert.equal(results[3].status, 'rejected');
    assert.deepEqual(results[9], { status: 'fulfilled', value: 20 });
  });

  it('returns an empty list for no items', async () => {
    assert.deepEqual(await settleWithLimit([], 5, async () => 1), []);
  });
});

describe('loadGitlabLiveConfig', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'harness-gitlab-live-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is undefined when neither file exists', () => {
    assert.equal(loadGitlabLiveConfig(makeConfigPaths(dir)), undefined);
  });

  it('is undefined when the credentials file has no gitlabToken', () => {
    const paths = makeConfigPaths(dir);
    writeFileSync(paths.syncCredentials, JSON.stringify({ refreshToken: 'r' }));
    writeFileSync(paths.syncConfig, JSON.stringify({ gitlab: { apiUrl: 'https://gitlab.example.com/api/v4' } }));

    assert.equal(loadGitlabLiveConfig(paths), undefined);
  });

  it('combines token + apiUrl from the two files when both are present', () => {
    const paths = makeConfigPaths(dir);
    writeFileSync(paths.syncCredentials, JSON.stringify({ gitlabToken: 'tok' }));
    writeFileSync(paths.syncConfig, JSON.stringify({ gitlab: { apiUrl: 'https://gitlab.example.com/api/v4' } }));

    assert.deepEqual(loadGitlabLiveConfig(paths), { apiUrl: 'https://gitlab.example.com/api/v4', token: 'tok' });
  });
});

describe('fetchGitlabLiveStatus', () => {
  let dir: string;
  let paths: GitlabLiveConfigPaths;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'harness-gitlab-live-'));
    paths = makeConfigPaths(dir);
    writeFileSync(paths.syncCredentials, JSON.stringify({ gitlabToken: 'tok' }));
    writeFileSync(paths.syncConfig, JSON.stringify({ gitlab: { apiUrl: 'https://gitlab.example.com/api/v4' } }));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  });

  it('reports unavailable with a clear reason when there is no GitLab token configured', async () => {
    rmSync(paths.syncCredentials);

    const result = await fetchGitlabLiveStatus([], paths);

    assert.equal(result.available, false);
    if (result.available) throw new Error('unreachable');
    assert.match(result.reason, /no GitLab token configured/);
  });

  it('reports unavailable when listAssignedOpenIssues itself fails (bad token, network)', async () => {
    globalThis.fetch = (async () => new Response('nope', { status: 401 })) as typeof fetch;

    const result = await fetchGitlabLiveStatus([], paths);

    assert.equal(result.available, false);
    if (result.available) throw new Error('unreachable');
    assert.match(result.reason, /GitLab live check failed/);
  });

  it('fetches issue state + MR/pipeline for a task with a resolvable branch, and lists unseen assigned issues as incoming', async () => {
    const tasks: TaskEntry[] = [
      { key: '402:6', subscription: { step: 'pushed', branch: 'mazur-402-6' } },
      { key: '402:7', syncAgent: { lastOwnOutputHash: 'abc' } }, // no branch — skipped
    ];

    globalThis.fetch = (async (url: string) => {
      if (url.includes('/issues?')) {
        return Response.json([
          { id: 1, iid: 6, project_id: 402, title: 'Already tracked', description: null },
          { id: 2, iid: 9, project_id: 402, title: 'Brand new', description: null },
        ]);
      }
      if (url.includes('/issues/6')) {
        return Response.json({ id: 1, iid: 6, project_id: 402, title: 'Already tracked', description: null, state: 'opened' });
      }
      if (url.includes('/merge_requests')) {
        return Response.json([{ iid: 42, title: 'Fix it', state: 'opened', web_url: 'https://gitlab.example.com/x/-/merge_requests/42', pipeline: { status: 'failed' } }]);
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;

    const result = await fetchGitlabLiveStatus(tasks, paths);

    assert.equal(result.available, true);
    if (!result.available) throw new Error('unreachable');

    const taskInfo = result.data.tasks.get('402:6');
    assert.equal(taskInfo?.issueState, 'opened');
    assert.deepEqual(taskInfo?.mergeRequest, { iid: 42, state: 'opened', pipelineStatus: 'failed' });
    assert.equal(result.data.tasks.has('402:7'), false);

    assert.deepEqual(result.data.incoming, [{ key: '402:9', projectId: 402, iid: 9, title: 'Brand new' }]);
  });

  it('leaves one task without GitLab info instead of failing everything when just that task\'s own lookup fails', async () => {
    const tasks: TaskEntry[] = [
      { key: '402:6', subscription: { step: 'pushed', branch: 'mazur-402-6' } },
      { key: '402:7', subscription: { step: 'pushed', branch: 'mazur-402-7' } },
    ];

    globalThis.fetch = (async (url: string) => {
      if (url.includes('/issues?')) return Response.json([]);
      if (url.includes('/issues/6')) return new Response('not found', { status: 404 });
      if (url.includes('/issues/7')) return Response.json({ id: 2, iid: 7, project_id: 402, title: 't', description: null, state: 'opened' });
      if (url.includes('/merge_requests')) return Response.json([]);
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;

    const result = await fetchGitlabLiveStatus(tasks, paths);

    assert.equal(result.available, true);
    if (!result.available) throw new Error('unreachable');
    assert.equal(result.data.tasks.has('402:6'), false);
    assert.equal(result.data.tasks.get('402:7')?.issueState, 'opened');
  });
});
