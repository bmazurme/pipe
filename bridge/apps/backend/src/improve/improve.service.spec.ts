import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

import { ImproveRunStatus } from './entities/improve-run.entity';
import { ImproveService, isDue, localDate } from './improve.service';
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
  const qbExecute = jest.fn().mockResolvedValue({ affected: 1 });
  const schedules = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    update: jest.fn(),
    createQueryBuilder: jest.fn(() => {
      const qb: Record<string, jest.Mock> = {};
      for (const name of ['update', 'set', 'where'])
        qb[name] = jest.fn(() => qb);
      qb.execute = qbExecute;
      return qb;
    }),
  };
  const settings = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn(async (s: object) => s),
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
    ...overrides.github,
  };
  const storage = {
    createFromBuffer: jest.fn().mockResolvedValue({ id: 99 }),
    findOwned: jest.fn(),
    path: jest.fn(),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const workers = {
    create: jest.fn().mockResolvedValue({ id: 321 }),
    findUnstartedIssueParcels: jest.fn().mockResolvedValue([]),
    findOwned: jest.fn(),
    cancel: jest.fn().mockResolvedValue(undefined),
  };
  const notifier = { send: jest.fn().mockResolvedValue(true) };
  const dataSource = { query: jest.fn().mockResolvedValue([]) };
  const appLogs = { record: jest.fn() };
  const service = new ImproveService(
    runs as never,
    schedules as never,
    settings as never,
    github as never,
    storage as never,
    workers as never,
    notifier as never,
    dataSource as never,
    appLogs as never,
  );

  return {
    service,
    runs,
    schedules,
    settings,
    github,
    storage,
    workers,
    notifier,
    dataSource,
    qbExecute,
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
    const { service, workers, runs } = setup();
    workers.findOwned.mockResolvedValue({ status: 'running' });

    await service.advanceOne(run() as never);

    expect(runs.update).toHaveBeenCalledWith(1, {
      status: ImproveRunStatus.Running,
    });
  });

  it('records a failed or cancelled job on the run', async () => {
    const failed = setup();
    failed.workers.findOwned.mockResolvedValue({
      status: 'failed',
      errorMessage: 'timed out',
    });
    const failedRun = run();
    await failed.service.advanceOne(failedRun as never);
    expect(failedRun).toMatchObject({
      status: ImproveRunStatus.Failed,
      error: 'timed out',
    });

    const cancelled = setup();
    cancelled.workers.findOwned.mockResolvedValue({ status: 'cancelled' });
    const cancelledRun = run();
    await cancelled.service.advanceOne(cancelledRun as never);
    expect(cancelledRun.status).toBe(ImproveRunStatus.Cancelled);
  });

  it('publishes only once even if two ticks overlap', async () => {
    const { service, workers, runs } = setup();
    workers.findOwned.mockResolvedValue({
      status: 'succeeded',
      resultFileId: 5,
    });
    runs.update.mockResolvedValue({ affected: 0 }); // someone else already claimed it
    const publish = jest.spyOn(service, 'publish').mockResolvedValue(undefined);

    await service.advanceOne(run() as never);

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
    ctx.storage.path.mockReturnValue(file);

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

describe('schedules', () => {
  // 2026-10-08T23:30:00Z is 02:30 on the 9th in Moscow (UTC+3).
  const now = new Date('2026-10-08T23:30:00Z');
  const schedule = {
    hour: 2,
    minute: 0,
    timezone: 'Europe/Moscow',
    lastRunOn: null as string | null,
  };

  it('is due once its local time has passed and it has not fired that local day', () => {
    expect(localDate(now, 'Europe/Moscow')).toBe('2026-10-09');
    expect(isDue(schedule, now)).toBe(true);
    expect(isDue({ ...schedule, lastRunOn: '2026-10-09' }, now)).toBe(false);
    expect(isDue({ ...schedule, lastRunOn: '2026-10-08' }, now)).toBe(true);
  });

  it('is not due before its time, and still due late (a bridge that was down at 02:00)', () => {
    expect(isDue({ ...schedule, hour: 3 }, now)).toBe(false);
    expect(isDue(schedule, new Date('2026-10-09T05:00:00Z'))).toBe(true); // 08:00 Moscow
  });

  it('fires a due schedule exactly once: only the tick that wins the compare-and-set runs it', async () => {
    const { service, schedules, qbExecute } = setup();
    schedules.find.mockResolvedValue([
      {
        id: 1,
        userId: 3,
        name: 'night',
        enabled: true,
        count: 2,
        model: 'sonnet',
        label: 'loop',
        ...schedule,
      },
    ]);
    const fire = jest
      .spyOn(service, 'fire')
      .mockResolvedValue({ started: [], skipped: [] });

    await service.tickSchedules(now);
    expect(fire).toHaveBeenCalledTimes(1);

    qbExecute.mockResolvedValue({ affected: 0 }); // another instance already claimed today's slot
    await service.tickSchedules(now);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('starts the oldest eligible issues up to count, skipping the ones that cannot start', async () => {
    const { service, github, runs, notifier } = setup();
    github.listOpenIssues.mockResolvedValue(
      [5, 6, 7, 8].map((number) => ({
        number,
        title: `t${number}`,
        body: '',
        state: 'open',
        labels: [],
      })),
    );
    runs.findOne
      .mockResolvedValueOnce({ status: ImproveRunStatus.PrOpen, prNumber: 9 }) // #5 already has a PR
      .mockResolvedValue(null);
    github.getIssue.mockImplementation(async (number: number) => ({
      number,
      title: `t${number}`,
      body: '',
      state: 'open',
      isPull: false,
      labels: [],
    }));

    const result = await service.fire({
      id: 1,
      userId: 3,
      name: 'night',
      count: 2,
      model: 'sonnet',
      label: 'loop',
    } as never);

    expect(result.started).toEqual([6, 7]);
    expect(result.skipped).toEqual([expect.stringContaining('#5')]);
    expect(notifier.send).toHaveBeenCalledWith(
      expect.stringContaining('2 запущено, 1 пропущено'),
    );
  });

  it('rejects an unknown time zone or model when saving', async () => {
    const { service } = setup();
    const input = {
      name: 'n',
      hour: 2,
      minute: 0,
      timezone: 'Mars/Base',
      count: 1,
      model: 'sonnet',
      enabled: true,
    };

    await expect(service.saveSchedule(3, input)).rejects.toThrow(
      /часовой пояс/,
    );
    await expect(
      service.saveSchedule(3, { ...input, timezone: 'UTC', model: 'x' }),
    ).rejects.toThrow(/Неизвестная модель/);
  });
});

describe('auto-start of pushed parcels', () => {
  it("starts a job for each parcel the query returns, with the account's model", async () => {
    const { service, settings, workers } = setup();
    const since = new Date('2026-10-01T00:00:00Z');
    settings.find.mockResolvedValue([
      { userId: 3, autoStartModel: 'opus', autoStartSince: since },
    ]);
    workers.findUnstartedIssueParcels.mockResolvedValue([{ id: 40 }]);
    workers.create.mockResolvedValue({ id: 77 });

    await service.autoStartParcels();

    expect(workers.create).toHaveBeenCalledTimes(1);
    expect(workers.create).toHaveBeenCalledWith(3, {
      sourceFileId: 40,
      model: 'opus',
    });
    // Worker owns which parcels are eligible; Improve only asks, excluding its own.
    expect(workers.findUnstartedIssueParcels).toHaveBeenCalledWith(
      3,
      since,
      expect.any(Number),
      'improve:',
    );
  });

  it('keeps going when one parcel cannot be started', async () => {
    const { service, settings, workers } = setup();
    settings.find.mockResolvedValue([
      { userId: 3, autoStartModel: 'gpt', autoStartSince: new Date() },
    ]);
    workers.findUnstartedIssueParcels.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    workers.create
      .mockRejectedValueOnce(new Error('File not found'))
      .mockResolvedValueOnce({ id: 9 });

    await service.autoStartParcels();

    expect(workers.create).toHaveBeenCalledTimes(2);
  });

  it('remembers when auto-start was switched on, so old parcels are never swept up', async () => {
    const { service, settings } = setup();

    await service.saveSettings(3, 'sonnet');
    expect(settings.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 3,
        autoStartModel: 'sonnet',
        autoStartSince: expect.any(Date),
      }),
    );

    await service.saveSettings(3, null);
    expect(settings.save).toHaveBeenLastCalledWith({
      userId: 3,
      autoStartModel: null,
      autoStartSince: null,
    });
    await expect(service.saveSettings(3, 'nope')).rejects.toThrow(
      /Неизвестная модель/,
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
