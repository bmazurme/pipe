import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { strToU8, zipSync } from 'fflate';

import { ImproveRunStatus } from './entities/improve-run.entity';
import {
  describePublishError,
  ImprovePublishService,
} from './improve-publish.service';
import { MANIFEST_ENTRY, sha256 } from './parcel';

const BASE = { 'a.ts': 'one', 'b.ts': 'two' };
const baselineOf = (files: Record<string, string>) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(files).map(([path, text]) => [
        path,
        sha256(strToU8(text)),
      ]),
    ),
  );

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'improve-publish-test-'));
  const runs: Record<string, jest.Mock> = {
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn(async (run: object) => ({ id: 1, ...run })),
  };
  const github = {
    isReady: jest.fn().mockReturnValue(true),
    repoName: jest.fn().mockReturnValue('o/r'),
    baseBranch: jest.fn().mockReturnValue('main'),
    listOpenIssues: jest.fn().mockResolvedValue([]),
    getIssue: jest.fn().mockResolvedValue({
      number: 7,
      title: 'Fix it',
      body: 'b',
      state: 'open',
      isPull: false,
      labels: [],
    }),
    getBranchSha: jest.fn().mockResolvedValue('base-sha'),
    downloadZipball: jest.fn().mockResolvedValue(
      zipSync({
        'o-r-sha/a.ts': strToU8('one'),
        'o-r-sha/b.ts': strToU8('two'),
      }),
    ),
    getCommitTreeSha: jest.fn().mockResolvedValue('tree-sha'),
    createBlob: jest
      .fn()
      .mockImplementation(
        async (bytes: Uint8Array) => `blob:${Buffer.from(bytes).toString()}`,
      ),
    createTree: jest.fn().mockResolvedValue('new-tree'),
    createCommit: jest.fn().mockResolvedValue('new-commit'),
    createBranch: jest.fn().mockResolvedValue(undefined),
    createPull: jest
      .fn()
      .mockResolvedValue({ number: 55, htmlUrl: 'https://gh/pr/55' }),
    addLabels: jest.fn().mockResolvedValue(undefined),
    deleteBranch: jest.fn().mockResolvedValue(undefined),
    updateBranch: jest.fn().mockResolvedValue(undefined),
  };
  const storage = {
    findOwned: jest.fn(),
    readBytes: jest.fn(),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const notifier = { send: jest.fn().mockResolvedValue(true) };
  const appLogs = { record: jest.fn() };
  const service = new ImprovePublishService(
    runs as never,
    github as never,
    storage as never,
    notifier as never,
    appLogs as never,
  );

  return { service, runs, github, storage, notifier, dir };
}

describe('ImprovePublishService.publish', () => {
  const run = (over = {}) => ({
    id: 4,
    userId: 3,
    issueNumber: 7,
    issueTitle: 'Fix it',
    model: 'opus',
    trigger: 'schedule',
    jobId: 321,
    status: ImproveRunStatus.Publishing,
    baseSha: 'base-sha',
    baseline: baselineOf(BASE),
    ...over,
  });

  function withResult(files: Record<string, string>) {
    const ctx = setup();
    const file = join(ctx.dir, 'result.zip');
    writeFileSync(
      file,
      zipSync({
        ...Object.fromEntries(
          Object.entries(files).map(([p, t]) => [p, strToU8(t)]),
        ),
        [MANIFEST_ENTRY]: strToU8('{}'),
      }),
    );
    ctx.storage.findOwned.mockResolvedValue({ id: 5 });
    ctx.storage.readBytes.mockResolvedValue(readFileSync(file));

    return ctx;
  }

  it('commits the changed files to a branch cut from the snapshot and opens a labelled PR', async () => {
    const { service, github, notifier } = withResult({
      'a.ts': 'one',
      'b.ts': 'TWO',
      'new.ts': 'n',
    });
    const r = run();

    await service.publish(r as never, 5);

    expect(github.createTree).toHaveBeenCalledWith('tree-sha', [
      { path: 'b.ts', mode: '100644', type: 'blob', sha: 'blob:TWO' },
      { path: 'new.ts', mode: '100644', type: 'blob', sha: 'blob:n' },
    ]);
    expect(github.createCommit).toHaveBeenCalledWith(
      expect.stringContaining('Pull issue #7: Fix it'),
      'new-tree',
      'base-sha',
    );
    expect(github.createBranch).toHaveBeenCalledWith(
      'improve/issue-7-run-4',
      'new-commit',
    );
    expect(github.createPull).toHaveBeenCalledWith(
      expect.objectContaining({
        head: 'improve/issue-7-run-4',
        base: 'main',
        body: expect.stringContaining('Closes #7'),
      }),
    );
    expect(github.addLabels).toHaveBeenCalledWith(55, ['loop']);
    expect(r).toMatchObject({
      status: ImproveRunStatus.PrOpen,
      prNumber: 55,
      branch: 'improve/issue-7-run-4',
    });
    expect(notifier.send).toHaveBeenCalledWith(
      expect.stringContaining('PR #55'),
    );
  });

  it('encodes a deletion as a null tree entry', async () => {
    const { service, github } = withResult({ 'a.ts': 'one' }); // b.ts removed

    await service.publish(run() as never, 5);

    expect(github.createTree).toHaveBeenCalledWith('tree-sha', [
      { path: 'b.ts', mode: '100644', type: 'blob', sha: null },
    ]);
  });

  describe('concurrent blob creation', () => {
    const many = (n: number) =>
      Object.fromEntries(
        Array.from({ length: n }, (_, i) => [`f${i}.ts`, `v${i}`]),
      );

    it('keeps the input order with added, modified and deleted changes', async () => {
      const { service, github } = withResult({
        'a.ts': 'ONE', // modified
        'new.ts': 'n', // added
      }); // b.ts deleted
      // later blobs finish first
      github.createBlob.mockImplementation(async (bytes: Uint8Array) => {
        const text = Buffer.from(bytes).toString();
        await new Promise((r) => setTimeout(r, text === 'ONE' ? 20 : 1));

        return `blob:${text}`;
      });

      await service.publish(run() as never, 5);

      expect(github.createBlob).toHaveBeenCalledTimes(2);
      expect(github.createTree).toHaveBeenCalledWith('tree-sha', [
        { path: 'a.ts', mode: '100644', type: 'blob', sha: 'blob:ONE' },
        { path: 'b.ts', mode: '100644', type: 'blob', sha: null },
        { path: 'new.ts', mode: '100644', type: 'blob', sha: 'blob:n' },
      ]);
    });

    it('runs blobs concurrently but never more than the cap at once', async () => {
      const { service, github } = withResult({ ...many(20) });
      let inFlight = 0;
      let peak = 0;
      github.createBlob.mockImplementation(async (bytes: Uint8Array) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;

        return `blob:${Buffer.from(bytes).toString()}`;
      });

      await service.publish(run() as never, 5);

      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(8);
      expect(github.createBlob).toHaveBeenCalledTimes(20);
    });

    it('aborts before createTree when a blob is rejected', async () => {
      const { service, github } = withResult({ 'a.ts': 'X', 'b.ts': 'Y' });
      github.createBlob.mockRejectedValueOnce(new Error('GitHub 500: boom'));
      const r = run();

      await service.publish(r as never, 5);

      expect(github.createTree).not.toHaveBeenCalled();
      expect(github.createCommit).not.toHaveBeenCalled();
      expect(r).toMatchObject({
        status: ImproveRunStatus.Failed,
        error: expect.stringContaining('boom'),
      });
    });
  });

  it('never proposes a change to a protected path', async () => {
    const baseline = baselineOf({ ...BASE, '.github/workflows/ci.yml': 'ci' });
    const { service, github } = withResult({
      'a.ts': 'one',
      'b.ts': 'TWO',
      '.github/workflows/ci.yml': 'EVIL',
    });
    const r = run({ baseline });

    await service.publish(r as never, 5);

    expect(github.createTree).toHaveBeenCalledWith('tree-sha', [
      { path: 'b.ts', mode: '100644', type: 'blob', sha: 'blob:TWO' },
    ]);
    expect((r as { note?: string }).note).toContain('.github/workflows/ci.yml');
  });

  it('finishes with no PR when nothing (or only protected paths) changed', async () => {
    const same = withResult(BASE);
    const r = run();
    await same.service.publish(r as never, 5);
    expect(r.status).toBe(ImproveRunStatus.NoChanges);
    expect(same.github.createPull).not.toHaveBeenCalled();

    const onlyProtected = withResult({ ...BASE, '.github/x.yml': 'new' });
    const r2 = run();
    await onlyProtected.service.publish(r2 as never, 5);
    expect(r2.status).toBe(ImproveRunStatus.NoChanges);
  });

  it('fails the run (and says so) when the result is missing or GitHub refuses', async () => {
    const missing = setup();
    const r = run();
    await missing.service.publish(r as never, null);
    expect(r).toMatchObject({
      status: ImproveRunStatus.Failed,
      error: expect.stringContaining('нет результата'),
    });

    const refused = withResult({ 'a.ts': 'X' });
    refused.github.createBranch.mockRejectedValue(
      new Error('GitHub 422: Reference already exists'),
    );
    const r2 = run();
    await refused.service.publish(r2 as never, 5);
    expect(r2).toMatchObject({
      status: ImproveRunStatus.Failed,
      error: expect.stringContaining('Reference already exists'),
    });
    expect(refused.notifier.send).toHaveBeenCalledWith(
      expect.stringContaining('не удалось открыть PR'),
    );
  });
});

describe('ImprovePublishService: no branch left behind', () => {
  const run = () => ({
    id: 4,
    userId: 3,
    issueNumber: 7,
    issueTitle: 'Fix it',
    model: 'opus',
    trigger: 'manual',
    jobId: 321,
    status: ImproveRunStatus.Publishing,
    baseSha: 'base-sha',
    baseline: baselineOf(BASE),
  });

  function withResult(files: Record<string, string>) {
    const ctx = setup();
    const file = join(ctx.dir, 'result.zip');
    writeFileSync(
      file,
      zipSync({
        ...Object.fromEntries(
          Object.entries(files).map(([p, t]) => [p, strToU8(t)]),
        ),
        [MANIFEST_ENTRY]: strToU8('{}'),
      }),
    );
    ctx.storage.findOwned.mockResolvedValue({ id: 5 });
    ctx.storage.readBytes.mockResolvedValue(readFileSync(file));

    return ctx;
  }

  it('deletes the branch it just created when the PR cannot be opened', async () => {
    const ctx = withResult({ 'a.ts': 'X' });
    ctx.github.createPull.mockRejectedValue(
      new Error('GitHub 403: Resource not accessible by personal access token'),
    );
    const r = run();

    await ctx.service.publish(r as never, 5);

    expect(ctx.github.createBranch).toHaveBeenCalledWith(
      'improve/issue-7-run-4',
      'new-commit',
    );
    expect(ctx.github.deleteBranch).toHaveBeenCalledWith(
      'improve/issue-7-run-4',
    );
    expect(r).toMatchObject({ status: ImproveRunStatus.Failed });
  });

  it('still reports the original failure when the cleanup fails too', async () => {
    const ctx = withResult({ 'a.ts': 'X' });
    ctx.github.createPull.mockRejectedValue(new Error('GitHub 422: nope'));
    ctx.github.deleteBranch.mockRejectedValue(new Error('GitHub 403: no'));
    const r = run();

    await ctx.service.publish(r as never, 5);

    expect(r).toMatchObject({
      status: ImproveRunStatus.Failed,
      error: expect.stringContaining('GitHub 422: nope'),
    });
  });

  it('does not touch a branch when it never got as far as creating one', async () => {
    const ctx = withResult({ 'a.ts': 'X' });
    ctx.github.createBranch.mockRejectedValue(new Error('GitHub 422: exists'));

    await ctx.service.publish(run() as never, 5);

    expect(ctx.github.deleteBranch).not.toHaveBeenCalled();
  });

  it('names the missing token permissions instead of just "Resource not accessible"', async () => {
    const ctx = withResult({ 'a.ts': 'X' });
    ctx.github.createPull.mockRejectedValue(
      new Error('GitHub 403: Resource not accessible by personal access token'),
    );
    const r = run();

    await ctx.service.publish(r as never, 5);

    expect((r as { error?: string }).error).toContain('Pull requests');
    expect((r as { error?: string }).error).toContain('LOOP_GITHUB_TOKEN');
    expect(describePublishError(new Error('GitHub 500: boom'))).toBe(
      'GitHub 500: boom',
    );
  });
});

describe('ImprovePublishService: publishing a repair', () => {
  const repair = () => ({
    id: 12,
    userId: 3,
    kind: 'repair',
    issueNumber: 7,
    issueTitle: 'Fix it',
    model: 'sonnet',
    trigger: 'ci',
    jobId: 400,
    status: ImproveRunStatus.Publishing,
    baseSha: 'head-sha',
    baseline: baselineOf(BASE),
    branch: 'improve/issue-7-run-9',
    prNumber: 55,
    prUrl: 'https://gh/pr/55',
    note: 'Автоисправление CI, попытка 1 из 2',
  });

  function withResult(files: Record<string, string>) {
    const ctx = setup();
    const file = join(ctx.dir, 'result.zip');
    writeFileSync(
      file,
      zipSync({
        ...Object.fromEntries(
          Object.entries(files).map(([p, t]) => [p, strToU8(t)]),
        ),
        [MANIFEST_ENTRY]: strToU8('{}'),
      }),
    );
    ctx.storage.findOwned.mockResolvedValue({ id: 5 });
    ctx.storage.readBytes.mockResolvedValue(readFileSync(file));

    return ctx;
  }

  it('commits on top of the PR head and moves the PR branch — no new branch, no new PR', async () => {
    const { service, github, notifier } = withResult({
      'a.ts': 'one',
      'b.ts': 'FIXED',
    });
    const r = repair();

    await service.publish(r as never, 5);

    expect(github.getCommitTreeSha).toHaveBeenCalledWith('head-sha');
    expect(github.createCommit).toHaveBeenCalledWith(
      expect.stringContaining('Fix CI on PR #55'),
      'new-tree',
      'head-sha',
    );
    expect(github.updateBranch).toHaveBeenCalledWith(
      'improve/issue-7-run-9',
      'new-commit',
    );
    expect(github.createBranch).not.toHaveBeenCalled();
    expect(github.createPull).not.toHaveBeenCalled();
    expect(r).toMatchObject({ status: ImproveRunStatus.PrUpdated });
    expect(notifier.send).toHaveBeenCalledWith(
      expect.stringContaining('автоисправление CI'),
    );
  });

  it('records "no changes" without touching the branch when the worker fixed nothing', async () => {
    const { service, github, notifier } = withResult(BASE);
    const r = repair();

    await service.publish(r as never, 5);

    expect(r.status).toBe(ImproveRunStatus.NoChanges);
    expect(github.updateBranch).not.toHaveBeenCalled();
    expect(notifier.send).toHaveBeenCalledWith(
      expect.stringContaining('не внесло изменений'),
    );
  });

  it('fails the repair run (the PR stays as it was) when the branch moved meanwhile', async () => {
    const { service, github, notifier } = withResult({ 'a.ts': 'X' });
    github.updateBranch.mockRejectedValue(
      new Error('GitHub 422: Update is not a fast forward'),
    );
    const r = repair();

    await service.publish(r as never, 5);

    expect(r).toMatchObject({
      status: ImproveRunStatus.Failed,
      error: expect.stringContaining('not a fast forward'),
    });
    expect(github.deleteBranch).not.toHaveBeenCalled();
    expect(notifier.send).toHaveBeenCalledWith(
      expect.stringContaining('PR #55: автоисправление CI не удалось'),
    );
  });

  it('never pushes a change to a protected path', async () => {
    const baseline = baselineOf({ ...BASE, '.github/ci.yml': 'ci' });
    const { service, github } = withResult({
      'a.ts': 'one',
      'b.ts': 'two',
      '.github/ci.yml': 'EVIL',
    });
    const r = { ...repair(), baseline };

    await service.publish(r as never, 5);

    expect(github.updateBranch).not.toHaveBeenCalled();
    expect(r.status).toBe(ImproveRunStatus.NoChanges);
  });
});
