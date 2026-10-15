import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { ConflictException } from '@nestjs/common';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

import { ImproveRunStatus } from './entities/improve-run.entity';
import { describePublishError, ImproveService } from './improve.service';
import * as parcel from './parcel';
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

function setup(
  overrides: {
    runs?: Record<string, unknown>;
    github?: Record<string, unknown>;
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'improve-test-'));
  const runs: Record<string, jest.Mock> = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn(async (run: object) => ({ id: 1, ...run })),
    create: jest.fn((run: object) => ({ ...run })),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    ...(overrides.runs as Record<string, jest.Mock>),
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
    ...overrides.github,
  };
  const storage = {
    createFromBuffer: jest.fn().mockResolvedValue({ id: 99 }),
    findOwned: jest.fn(),
    readBytes: jest.fn(),
    exists: jest.fn().mockResolvedValue(true),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const workers = {
    create: jest.fn().mockResolvedValue({ id: 321 }),
    findUnstartedIssueParcels: jest.fn().mockResolvedValue([]),
    findOwned: jest.fn(),
    findStatuses: jest.fn().mockResolvedValue([]),
    findRetriesOf: jest.fn().mockResolvedValue(new Map()),
    cancel: jest.fn().mockResolvedValue(undefined),
  };
  const notifier = { send: jest.fn().mockResolvedValue(true) };
  const dataSource = { query: jest.fn().mockResolvedValue([]) };
  const appLogs = { record: jest.fn() };
  const service = new ImproveService(
    runs as never,
    github as never,
    {} as never,
    storage as never,
    workers as never,
    notifier as never,
    dataSource as never,
    appLogs as never,
  );

  return {
    service,
    runs,
    github,
    storage,
    workers,
    notifier,
    dataSource,
    dir,
  };
}

describe('ImproveService.startRun', () => {
  it('snapshots the repo, stores the parcel, starts a worker job and records the run', async () => {
    const { service, github, storage, workers, runs } = setup();

    const run = await service.startRun(3, 7, 'sonnet');

    expect(github.getBranchSha).toHaveBeenCalledWith('main');
    expect(github.downloadZipball).toHaveBeenCalledWith('base-sha');
    expect(storage.createFromBuffer).toHaveBeenCalledWith(
      3,
      expect.any(Buffer),
      'improve-7.subscription.zip',
      expect.objectContaining({
        channel: 'issue',
        taskKey: 'improve:7',
        direction: 'outbound',
      }),
    );
    expect(workers.create).toHaveBeenCalledWith(3, {
      sourceFileId: 99,
      model: 'sonnet',
    });
    expect(runs.save).toHaveBeenCalledWith(
      expect.objectContaining({
        issueNumber: 7,
        jobId: 321,
        baseSha: 'base-sha',
        status: 'queued',
      }),
    );
    expect(JSON.parse(run.baseline as string)).toEqual(
      JSON.parse(baselineOf(BASE)),
    );
  });

  it('refuses an issue that is already being worked on or has an open PR', async () => {
    const active = setup({
      runs: {
        findOne: jest
          .fn()
          .mockResolvedValue({ status: ImproveRunStatus.Running }),
      },
    });
    await expect(active.service.startRun(3, 7, 'sonnet')).rejects.toThrow(
      /уже выполняется/,
    );

    const withPr = setup({
      runs: {
        findOne: jest
          .fn()
          .mockResolvedValue({ status: ImproveRunStatus.PrOpen, prNumber: 12 }),
      },
    });
    await expect(withPr.service.startRun(3, 7, 'sonnet')).rejects.toThrow(
      /уже открыт PR #12/,
    );
    expect(withPr.workers.create).not.toHaveBeenCalled();
  });

  it('refuses a closed issue, a pull request, an unknown model and an unconfigured GitHub', async () => {
    const closed = setup({
      github: {
        getIssue: jest.fn().mockResolvedValue({
          number: 7,
          title: 't',
          body: '',
          state: 'closed',
          isPull: false,
        }),
      },
    });
    await expect(closed.service.startRun(3, 7, 'sonnet')).rejects.toThrow(
      /не открытая/,
    );

    const pull = setup({
      github: {
        getIssue: jest.fn().mockResolvedValue({
          number: 7,
          title: 't',
          body: '',
          state: 'open',
          isPull: true,
        }),
      },
    });
    await expect(pull.service.startRun(3, 7, 'sonnet')).rejects.toThrow(
      /не открытая/,
    );

    await expect(setup().service.startRun(3, 7, 'gpt-9')).rejects.toThrow(
      /Неизвестная модель/,
    );

    const off = setup({
      github: { isReady: jest.fn().mockReturnValue(false) },
    });
    await expect(off.service.startRun(3, 7, 'sonnet')).rejects.toThrow(
      /GitHub не настроен/,
    );
  });
});

describe('ImproveService.advanceOne', () => {
  const run = (over = {}) => ({
    id: 1,
    userId: 3,
    issueNumber: 7,
    issueTitle: 'Fix it',
    model: 'sonnet',
    trigger: 'manual',
    jobId: 321,
    status: ImproveRunStatus.Queued,
    baseSha: 'base-sha',
    baseline: baselineOf(BASE),
    ...over,
  });

  it('follows the job: queued → running', async () => {
    const { service, runs } = setup();

    await service.advanceOne(
      run() as never,
      { userId: 3, status: 'running' } as never,
    );

    expect(runs.update).toHaveBeenCalledWith(1, {
      status: ImproveRunStatus.Running,
    });
  });

  it('records a failed or cancelled job on the run', async () => {
    const failed = setup();
    const failedRun = run();
    await failed.service.advanceOne(
      failedRun as never,
      { userId: 3, status: 'failed', errorMessage: 'timed out' } as never,
    );
    expect(failedRun).toMatchObject({
      status: ImproveRunStatus.Failed,
      error: 'timed out',
    });

    const cancelled = setup();
    const cancelledRun = run();
    await cancelled.service.advanceOne(
      cancelledRun as never,
      { userId: 3, status: 'cancelled' } as never,
    );
    expect(cancelledRun.status).toBe(ImproveRunStatus.Cancelled);
  });

  it('publishes only once even if two ticks overlap', async () => {
    const { service, runs } = setup();
    runs.update.mockResolvedValue({ affected: 0 }); // someone else already claimed it
    const publish = jest.spyOn(service, 'publish').mockResolvedValue(undefined);

    await service.advanceOne(
      run() as never,
      { userId: 3, status: 'succeeded', resultFileId: 5 } as never,
    );

    expect(publish).not.toHaveBeenCalled();
  });
});

describe('ImproveService.publish', () => {
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

describe('ImproveService.startRun task text', () => {
  it('hands the worker the issue followed by the definition of done', async () => {
    const { service, storage } = setup();

    await service.startRun(3, 7, 'sonnet');

    const parcel = unzipSync(
      new Uint8Array(storage.createFromBuffer.mock.calls[0][1]),
    );
    const manifest = strFromU8(parcel[MANIFEST_ENTRY]);

    expect(manifest).toContain('Fix it');
    expect(manifest).toContain('Definition of done');
    expect(manifest.indexOf('Fix it')).toBeLessThan(
      manifest.indexOf('Definition of done'),
    );
  });
});

describe('ImproveService publish: no branch left behind', () => {
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

describe('ImproveService CI repair', () => {
  const parent = {
    id: 9,
    userId: 3,
    kind: 'issue',
    issueNumber: 7,
    issueTitle: 'Fix it',
    model: 'sonnet',
    status: ImproveRunStatus.PrOpen,
    branch: 'improve/issue-7-run-9',
    prNumber: 55,
    prUrl: 'https://gh/pr/55',
  };
  const pull = {
    number: 55,
    headSha: 'head-sha',
    branch: 'improve/issue-7-run-9',
  };

  it('works on the PR head (not the base branch), with the failures and the definition of done in the task', async () => {
    const { service, github, storage, workers, runs } = setup({
      runs: { count: jest.fn().mockResolvedValue(0) },
    });

    const run = await service.startRepair(
      parent as never,
      pull,
      '### bridge — failure\n- a.ts:1 [failure] prettier/prettier',
    );

    expect(github.getBranchSha).not.toHaveBeenCalled();
    expect(github.downloadZipball).toHaveBeenCalledWith('head-sha');

    const manifest = strFromU8(
      unzipSync(new Uint8Array(storage.createFromBuffer.mock.calls[0][1]))[
        MANIFEST_ENTRY
      ],
    );

    expect(manifest).toContain('prettier/prettier');
    expect(manifest).toContain('exactly the head of that branch');
    expect(manifest).toContain('Definition of done');
    expect(manifest).toContain('repair attempt 1 of 2');
    expect(workers.create).toHaveBeenCalledWith(
      3,
      expect.objectContaining({ model: 'sonnet' }),
    );
    expect(run).toMatchObject({
      kind: 'repair',
      trigger: 'ci',
      status: ImproveRunStatus.Queued,
      issueNumber: 7,
      prNumber: 55,
      branch: 'improve/issue-7-run-9',
      baseSha: 'head-sha',
      jobId: 321,
    });
    expect(runs.save).toHaveBeenCalled();
  });

  it('numbers the attempts from the repairs this PR already had', async () => {
    const { service, storage } = setup({
      runs: { count: jest.fn().mockResolvedValue(1) },
    });

    const run = await service.startRepair(parent as never, pull, 'x');

    expect(run.note).toContain('попытка 2 из 2');
    expect(
      strFromU8(
        unzipSync(new Uint8Array(storage.createFromBuffer.mock.calls[0][1]))[
          MANIFEST_ENTRY
        ],
      ),
    ).toContain('repair attempt 2 of 2');
  });

  it('refuses when GitHub is not configured', async () => {
    const { service, github } = setup({
      runs: { count: jest.fn().mockResolvedValue(0) },
    });
    github.isReady.mockReturnValue(false);

    await expect(
      service.startRepair(parent as never, pull, 'x'),
    ).rejects.toThrow(/GitHub не настроен/);
  });

  describe('publishing a repair', () => {
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
});

describe('ImproveService.retryPublish', () => {
  const failedRun = (over = {}) => ({
    id: 4,
    userId: 3,
    kind: 'issue',
    issueNumber: 7,
    issueTitle: 'Fix it',
    model: 'opus',
    trigger: 'manual',
    jobId: 321,
    status: ImproveRunStatus.Failed,
    error: 'GitHub 403',
    baseSha: 'base-sha',
    baseline: baselineOf(BASE),
    ...over,
  });

  function withResult() {
    const ctx = setup();
    const file = join(ctx.dir, 'result.zip');
    writeFileSync(
      file,
      zipSync({
        'a.ts': strToU8('one'),
        'b.ts': strToU8('TWO'),
        [MANIFEST_ENTRY]: strToU8('{}'),
      }),
    );
    ctx.storage.findOwned.mockResolvedValue({ id: 5 });
    ctx.storage.exists.mockResolvedValue(true);
    ctx.storage.readBytes.mockResolvedValue(readFileSync(file));
    ctx.workers.findOwned.mockResolvedValue({
      status: 'succeeded',
      resultFileId: 5,
    });

    return ctx;
  }

  it('publishes a failed run again from the kept parcel without a new job', async () => {
    const { service, runs, workers, storage } = withResult();
    const run = failedRun();
    runs.findOne.mockResolvedValue(run);

    const result = await service.retryPublish(4, 3);

    expect(result).toMatchObject({
      status: ImproveRunStatus.PrOpen,
      prNumber: 55,
      error: null,
    });
    expect(workers.create).not.toHaveBeenCalled();
    expect(storage.delete).toHaveBeenCalledTimes(1);
  });

  it('rejects a run that is not failed with 409', async () => {
    const { service, runs } = withResult();
    runs.findOne.mockResolvedValue(
      failedRun({ status: ImproveRunStatus.PrOpen }),
    );

    await expect(service.retryPublish(4, 3)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('rejects a run whose job never produced a result with 409', async () => {
    const { service, runs, workers } = withResult();
    runs.findOne.mockResolvedValue(failedRun());
    workers.findOwned.mockResolvedValue({
      status: 'failed',
      resultFileId: null,
    });

    await expect(service.retryPublish(4, 3)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('says so clearly when the stored record is there but its file is not', async () => {
    const { service, runs, storage } = withResult();
    runs.findOne.mockResolvedValue(failedRun());
    storage.exists.mockResolvedValue(false);

    await expect(service.retryPublish(4, 3)).rejects.toThrow(
      /Файл результата уже удалён/,
    );
  });

  it('says so clearly when the result file is gone', async () => {
    const { service, runs, storage } = withResult();
    runs.findOne.mockResolvedValue(failedRun());
    storage.findOwned.mockRejectedValue(new Error('not found'));

    await expect(service.retryPublish(4, 3)).rejects.toThrow(
      /Файл результата уже удалён/,
    );
  });
});

describe('ImproveService zipball reuse', () => {
  it('downloads the zipball once for several issues on the same base SHA', async () => {
    const { service, github } = setup();

    const result = await service.startMany(3, [1, 2, 3], 'sonnet');

    expect(result.started).toEqual([1, 2, 3]);
    expect(github.downloadZipball).toHaveBeenCalledTimes(1);
  });

  it('downloads again when the base SHA changes', async () => {
    const { service, github } = setup();
    github.getBranchSha
      .mockResolvedValueOnce('sha-1')
      .mockResolvedValueOnce('sha-1')
      .mockResolvedValue('sha-2');

    await service.startMany(3, [1, 2, 3], 'sonnet');

    expect(github.downloadZipball).toHaveBeenCalledTimes(2);
    expect(github.downloadZipball).toHaveBeenNthCalledWith(1, 'sha-1');
    expect(github.downloadZipball).toHaveBeenNthCalledWith(2, 'sha-2');
  });

  it('downloads again once the cached entry is older than the TTL', async () => {
    const { service, github } = setup();
    const t0 = Date.now();
    const now = jest.spyOn(Date, 'now');
    try {
      now.mockReturnValue(t0);
      await service.startRun(3, 1, 'sonnet');
      now.mockReturnValue(t0 + 11 * 60 * 1000);
      await service.startRun(3, 2, 'sonnet');
    } finally {
      now.mockRestore();
    }

    expect(github.downloadZipball).toHaveBeenCalledTimes(2);
  });
});

describe('ImproveService snapshot baseline reuse', () => {
  let hash: jest.SpyInstance;
  beforeEach(() => {
    hash = jest.spyOn(parcel, 'snapshotBaseline');
  });
  afterEach(() => hash.mockRestore());

  const storedBaselines = (runs: Record<string, jest.Mock>) =>
    runs.create.mock.calls.map(
      ([run]) => (run as { baseline: string }).baseline,
    );

  it('hashes the snapshot once for several issues on the same base SHA', async () => {
    const { service, runs } = setup();

    await service.startMany(3, [1, 2, 3], 'sonnet');

    expect(hash).toHaveBeenCalledTimes(1);
    expect(storedBaselines(runs)).toEqual([
      baselineOf(BASE),
      baselineOf(BASE),
      baselineOf(BASE),
    ]);
  });

  it('hashes again when the base SHA changes', async () => {
    const { service, github } = setup();
    github.getBranchSha
      .mockResolvedValueOnce('sha-1')
      .mockResolvedValueOnce('sha-1')
      .mockResolvedValue('sha-2');

    await service.startMany(3, [1, 2, 3], 'sonnet');

    expect(hash).toHaveBeenCalledTimes(2);
  });

  it('hashes again once the cached entry is older than the TTL', async () => {
    const { service } = setup();
    const t0 = Date.now();
    const now = jest.spyOn(Date, 'now');
    try {
      now.mockReturnValue(t0);
      await service.startRun(3, 1, 'sonnet');
      now.mockReturnValue(t0 + 11 * 60 * 1000);
      await service.startRun(3, 2, 'sonnet');
    } finally {
      now.mockRestore();
    }

    expect(hash).toHaveBeenCalledTimes(2);
  });
});

describe('ImproveService.advance — stale publishing runs', () => {
  const publishing = (over = {}) => ({
    id: 8,
    userId: 3,
    issueNumber: 7,
    issueTitle: 'Fix it',
    jobId: 321,
    status: ImproveRunStatus.Publishing,
    ...over,
  });

  // Answers each query by the status it filters on, like the real repository.
  const findByStatus =
    (publishingRuns: object[], activeRuns: object[] = []) =>
    async ({ where }: { where: { status: unknown } }) =>
      where.status === ImproveRunStatus.Publishing
        ? publishingRuns
        : where.status === ImproveRunStatus.Failed
          ? []
          : activeRuns;

  it('fails a run stuck in publishing, with an explanation', async () => {
    const stuck = publishing();
    const { service, runs } = setup({
      runs: { find: jest.fn(findByStatus([stuck])) },
    });

    await service.advance();

    expect(stuck).toMatchObject({
      status: ImproveRunStatus.Failed,
      error: expect.stringContaining('Публикация прервана'),
    });
    expect(runs.save).toHaveBeenCalledWith(stuck);
    const where = runs.find.mock.calls[0][0].where;
    expect(where.status).toBe(ImproveRunStatus.Publishing);
    expect(where.updatedAt).toBeDefined();
  });

  it('leaves a freshly claimed run alone', async () => {
    // The repository filters by age, so a fresh run is simply not returned.
    const { service, runs } = setup({
      runs: { find: jest.fn(findByStatus([])) },
    });

    await service.advance();

    expect(runs.save).not.toHaveBeenCalled();
  });

  it('still advances a queued run as before', async () => {
    const queued = publishing({ status: ImproveRunStatus.Queued });
    const { service, workers, runs } = setup({
      runs: { find: jest.fn(findByStatus([], [queued])) },
    });
    workers.findStatuses.mockResolvedValue([
      { id: 321, userId: 3, status: 'running' },
    ]);

    await service.advance();

    expect(runs.update).toHaveBeenCalledWith(8, {
      status: ImproveRunStatus.Running,
    });
  });

  it('reads the statuses of all active runs in one query', async () => {
    const a = publishing({
      id: 8,
      jobId: 321,
      status: ImproveRunStatus.Queued,
    });
    const b = publishing({
      id: 9,
      jobId: 322,
      status: ImproveRunStatus.Queued,
    });
    const { service, workers, runs } = setup({
      runs: { find: jest.fn(findByStatus([], [a, b])) },
    });
    workers.findStatuses.mockResolvedValue([
      { id: 321, userId: 3, status: 'running' },
      { id: 322, userId: 3, status: 'running' },
    ]);

    await service.advance();

    expect(workers.findStatuses).toHaveBeenCalledTimes(1);
    expect(workers.findStatuses).toHaveBeenCalledWith([321, 322]);
    expect(workers.findOwned).not.toHaveBeenCalled();
    expect(runs.update).toHaveBeenCalledWith(8, {
      status: ImproveRunStatus.Running,
    });
    expect(runs.update).toHaveBeenCalledWith(9, {
      status: ImproveRunStatus.Running,
    });
  });

  it('does not advance a run whose job is missing or owned by someone else', async () => {
    const a = publishing({
      id: 8,
      jobId: 321,
      status: ImproveRunStatus.Queued,
    });
    const b = publishing({
      id: 9,
      jobId: 322,
      status: ImproveRunStatus.Queued,
    });
    const { service, workers, runs } = setup({
      runs: { find: jest.fn(findByStatus([], [a, b])) },
    });
    workers.findStatuses.mockResolvedValue([
      { id: 322, userId: 99, status: 'running' },
    ]);

    await service.advance();

    expect(runs.update).not.toHaveBeenCalled();
  });
});

describe('ImproveService.cancelRun', () => {
  const runRow = (status: ImproveRunStatus) => ({
    id: 5,
    userId: 1,
    jobId: 77,
    status,
  });

  it('cancels a queued run and its job with a guarded update', async () => {
    const { service, runs, workers } = setup();
    runs.findOne
      .mockResolvedValueOnce(runRow(ImproveRunStatus.Queued))
      .mockResolvedValueOnce(runRow(ImproveRunStatus.Cancelled));

    const res = await service.cancelRun(5, 1);

    expect(runs.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 5 }),
      expect.objectContaining({ status: ImproveRunStatus.Cancelled }),
    );
    expect(workers.cancel).toHaveBeenCalledWith(77, 1);
    expect(res.status).toBe(ImproveRunStatus.Cancelled);
    expect(runs.save).not.toHaveBeenCalled();
  });

  it('refuses a publishing run with 409 and saves nothing', async () => {
    const { service, runs, workers } = setup();
    runs.findOne.mockResolvedValue(runRow(ImproveRunStatus.Publishing));

    await expect(service.cancelRun(5, 1)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(runs.update).not.toHaveBeenCalled();
    expect(runs.save).not.toHaveBeenCalled();
    expect(workers.cancel).not.toHaveBeenCalled();
  });

  it('returns the current row when the publish claim wins the race', async () => {
    const { service, runs, workers } = setup();
    runs.update.mockResolvedValue({ affected: 0 });
    runs.findOne
      .mockResolvedValueOnce(runRow(ImproveRunStatus.Running))
      .mockResolvedValueOnce(runRow(ImproveRunStatus.Publishing));

    const res = await service.cancelRun(5, 1);

    expect(res.status).toBe(ImproveRunStatus.Publishing);
    expect(workers.cancel).not.toHaveBeenCalled();
  });
});

describe('ImproveService following a retried job', () => {
  const failedRun = {
    id: 99,
    userId: 3,
    kind: 'issue',
    issueNumber: 312,
    status: ImproveRunStatus.Failed,
    jobId: 102,
    error:
      'Worker was stopped (SIGTERM) before the job finished — start it again',
    finishedAt: new Date(),
  };

  const start = (oldStatus: string, retry?: object) => {
    const ctx = setup({
      runs: {
        find: jest.fn(async ({ where }: { where: { status: unknown } }) =>
          where.status === ImproveRunStatus.Failed ? [failedRun] : [],
        ),
      },
    });

    ctx.workers.findStatuses.mockResolvedValue([
      { id: 102, userId: 3, status: oldStatus },
    ]);
    ctx.workers.findRetriesOf.mockResolvedValue(
      retry ? new Map([[102, retry]]) : new Map(),
    );

    return ctx;
  };

  it('queues the run again on the new job when a failed job was retried from the Worker page', async () => {
    const { service, runs, workers } = start('failed', {
      id: 103,
      userId: 3,
      status: 'running',
    });

    await service.advance();

    expect(workers.findRetriesOf).toHaveBeenCalledWith([102]);
    expect(runs.update).toHaveBeenCalledWith(
      { id: 99, status: ImproveRunStatus.Failed },
      {
        jobId: 103,
        status: ImproveRunStatus.Queued,
        error: null,
        finishedAt: null,
      },
    );
  });

  it('does the same for a stopped job', async () => {
    const { service, runs } = start('cancelled', {
      id: 103,
      userId: 3,
      status: 'queued',
    });

    await service.advance();

    expect(runs.update).toHaveBeenCalledWith(
      { id: 99, status: ImproveRunStatus.Failed },
      expect.objectContaining({ jobId: 103 }),
    );
  });

  it('leaves a run alone when its job succeeded (that is a publishing failure, with its own retry)', async () => {
    const { service, runs, workers } = start('succeeded');

    await service.advance();

    expect(workers.findRetriesOf).toHaveBeenCalledWith([]);
    expect(runs.update).not.toHaveBeenCalled();
  });

  it('leaves a run alone when its job was not retried', async () => {
    const { service, runs } = start('failed');

    await service.advance();

    expect(runs.update).not.toHaveBeenCalled();
  });

  it('never follows a job that belongs to someone else', async () => {
    const { service, runs } = start('failed', {
      id: 103,
      userId: 9,
      status: 'running',
    });

    await service.advance();

    expect(runs.update).not.toHaveBeenCalled();
  });
});

describe('ImproveService change of a PR from the chat', () => {
  const open = {
    number: 304,
    title: 'Allowlist',
    state: 'open',
    merged: false,
    headSha: 'head-sha',
    headRef: 'improve/issue-297-run-78',
    headRepo: 'o/r',
    htmlUrl: 'https://gh/pr/304',
  };

  const start = (pull: object, runs: Record<string, unknown> = {}) => {
    return setup({
      runs: { count: jest.fn().mockResolvedValue(0), ...runs },
      github: { getPull: jest.fn().mockResolvedValue(pull) },
    });
  };

  it('hands the PR branch and the request to a worker, as a repair run that is not a CI one', async () => {
    const { service, github, storage, runs } = start(open);

    const run = await service.startPrFix(3, 304, 'Rename the helper', 'sonnet');

    expect(github.downloadZipball).toHaveBeenCalledWith('head-sha');

    const manifest = strFromU8(
      unzipSync(new Uint8Array(storage.createFromBuffer.mock.calls[0][1]))[
        MANIFEST_ENTRY
      ],
    );

    expect(manifest).toContain('Rename the helper');
    expect(manifest).toContain('Definition of done');
    expect(run).toMatchObject({
      kind: 'repair',
      trigger: 'chat',
      issueNumber: null,
      prNumber: 304,
      branch: 'improve/issue-297-run-78',
      baseSha: 'head-sha',
      prUrl: 'https://gh/pr/304',
    });
    expect(runs.save).toHaveBeenCalled();
  });

  it('refuses a closed or merged PR', async () => {
    await expect(
      start({ ...open, state: 'closed' }).service.startPrFix(
        3,
        304,
        'x y z',
        'sonnet',
      ),
    ).rejects.toThrow(/не открыт/);
    await expect(
      start({ ...open, merged: true }).service.startPrFix(
        3,
        304,
        'x y z',
        'sonnet',
      ),
    ).rejects.toThrow(/не открыт/);
  });

  it('refuses a PR from a fork — its branch cannot be pushed to', async () => {
    await expect(
      start({ ...open, headRepo: 'someone/r' }).service.startPrFix(
        3,
        304,
        'x y z',
        'sonnet',
      ),
    ).rejects.toThrow(/другого репозитория/);
  });

  it('refuses while another change of the same PR is running', async () => {
    const ctx = start(open, { count: jest.fn().mockResolvedValue(1) });

    await expect(
      ctx.service.startPrFix(3, 304, 'x y z', 'sonnet'),
    ).rejects.toThrow(/уже исправляется/);
    expect(ctx.workers.create).not.toHaveBeenCalled();
  });
});
