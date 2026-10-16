import { ImproveRunStatus } from './entities/improve-run.entity';
import { ImproveIssueFilingService } from './improve-issue-filing.service';
import { ImproveService } from './improve.service';
import { zipSync, strToU8 } from 'fflate';

function setup(runOverrides: Record<string, unknown> = {}) {
  const runs = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn(async (run: object) => ({ id: 1, ...run })),
    create: jest.fn((run: object) => ({ ...run })),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    ...runOverrides,
  };
  const github = {
    isReady: jest.fn().mockReturnValue(true),
    repoName: jest.fn().mockReturnValue('o/r'),
    baseBranch: jest.fn().mockReturnValue('main'),
    getBranchSha: jest.fn().mockResolvedValue('base-sha'),
    downloadZipball: jest
      .fn()
      .mockResolvedValue(zipSync({ 'o-r-sha/a.ts': strToU8('one') })),
    listIssueTitles: jest
      .fn()
      .mockResolvedValue([{ number: 5, title: 'Add Rate Limit!' }]),
    createIssue: jest.fn(async () => ({
      number: 40,
      missingLabels: [] as string[],
    })),
  };
  const storage = {
    createFromBuffer: jest.fn().mockResolvedValue({ id: 99 }),
    delete: jest.fn(),
  };
  const workers = { create: jest.fn().mockResolvedValue({ id: 321 }) };
  const appLogs = {
    record: jest.fn(),
    summary: jest.fn().mockRejectedValue(new Error('no table')),
    list: jest.fn().mockResolvedValue([]),
  };
  const filing = new ImproveIssueFilingService(
    runs as never,
    github as never,
    appLogs as never,
  );
  const service = new ImproveService(
    runs as never,
    github as never,
    {} as never,
    storage as never,
    workers as never,
    { send: jest.fn() } as never,
    { query: jest.fn() } as never,
    appLogs as never,
    filing as never,
  );

  return { service, filing, runs, github, workers, storage, appLogs };
}

describe('ImproveService analysis', () => {
  it('hands an analysis to the worker with the existing titles in the prompt', async () => {
    const { service, runs, workers } = setup();

    const run = await service.startAnalysis(3, 'sonnet');

    expect(workers.create).toHaveBeenCalled();
    expect(run).toMatchObject({
      kind: 'analysis',
      issueNumber: null,
      status: ImproveRunStatus.Queued,
      jobId: 321,
    });
    expect(runs.save).toHaveBeenCalled();
  });

  it('attaches a saved context to the worker job, and none by default', async () => {
    const withContext = setup();

    await withContext.service.startAnalysis(
      3,
      'sonnet',
      undefined,
      false,
      'schedule',
      1,
      false,
      4,
    );
    expect(withContext.workers.create).toHaveBeenCalledWith(
      3,
      expect.objectContaining({ contextId: 4 }),
    );

    const without = setup();

    await without.service.startAnalysis(3, 'sonnet');
    expect(without.workers.create.mock.calls[0][1]).not.toHaveProperty(
      'contextId',
    );
  });

  it('refuses a second analysis while one is active', async () => {
    const { service } = setup({
      findOne: jest.fn().mockResolvedValue({ id: 2 }),
    });

    await expect(service.startAnalysis(3, 'sonnet')).rejects.toThrow(
      'Анализ уже выполняется',
    );
  });

  it('refuses an empty or unknown direction list', async () => {
    const { service } = setup();

    await expect(service.startAnalysis(3, 'sonnet', [])).rejects.toThrow();
    await expect(
      service.startAnalysis(3, 'sonnet', ['nope' as never]),
    ).rejects.toThrow();
  });

  it('files proposals as issues but skips a duplicate title', async () => {
    const { filing, github } = setup();
    const run = {
      id: 1,
      result: JSON.stringify({
        categories: ['security', 'performance'],
        autoCreate: false,
        items: [
          {
            category: 'security',
            title: 'add rate limit',
            risk: 'low',
            body: 'x',
          },
          {
            category: 'performance',
            title: 'Cache lists',
            risk: 'low',
            body: 'y',
          },
        ],
      }),
    };

    const summary = await filing.fileProposals(run as never);

    expect(github.createIssue).toHaveBeenCalledTimes(1);
    expect(github.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Cache lists',
        labels: ['loop', 'risk:low', 'category:performance'],
      }),
    );
    expect(summary).toBe('создано задач: 1, дубликатов пропущено: 1');
    const stored = JSON.parse(run.result);
    expect(stored.items[0].duplicateOf).toBe(5);
    expect(stored.items[1].issueNumber).toBe(40);
  });

  it('still starts an analysis when the logs cannot be read', async () => {
    const { service, workers } = setup();

    await expect(service.startAnalysis(3, 'sonnet')).resolves.toMatchObject({
      kind: 'analysis',
    });
    expect(workers.create).toHaveBeenCalled();
  });

  it('puts the log digest into the task handed to the worker', async () => {
    const { service, storage, appLogs } = setup();
    appLogs.summary.mockResolvedValue({
      days: 7,
      total: 3,
      byLevel: { error: 3 },
      bySource: {},
      jobs: { succeeded: 0, failed: 3, successRate: 0, avgDurationMs: null },
      topErrors: [{ message: 'claude exited with code N', count: 3 }],
      slowestRoutes: [],
    });

    await service.startAnalysis(3, 'sonnet');

    const { unzipSync, strFromU8 } = await import('fflate');
    const files = unzipSync(
      new Uint8Array(storage.createFromBuffer.mock.calls[0][1]),
    );
    const text = Object.values(files)
      .map((f) => strFromU8(f))
      .join('\n');

    expect(text).toContain('Top failure ×3: claude exited with code N');
  });

  it('starts many issues, reporting the ones that could not start', async () => {
    const { service } = setup();
    const startRun = jest
      .spyOn(service, 'startRun')
      .mockImplementation(async (_user, issue) => {
        if (issue === 2) throw new Error('уже выполняется');

        return {} as never;
      });

    const result = await service.startMany(3, [1, 2, 3], 'sonnet');

    expect(startRun).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      started: [1, 3],
      skipped: ['#2: уже выполняется'],
    });
  });

  it('files the chosen proposals and starts a run for each filed issue', async () => {
    const run = {
      id: 1,
      userId: 3,
      model: 'sonnet',
      status: ImproveRunStatus.Analyzed,
      result: JSON.stringify({
        categories: ['performance'],
        autoCreate: false,
        items: [
          {
            category: 'performance',
            title: 'Cache lists',
            risk: 'low',
            body: 'y',
          },
        ],
      }),
    };
    const { service } = setup({ findOne: jest.fn().mockResolvedValue(run) });
    const startRun = jest
      .spyOn(service, 'startRun')
      .mockResolvedValue({} as never);

    await service.startItems(1, 'opus');

    expect(startRun).toHaveBeenCalledWith(3, 40, 'opus');
    expect(JSON.parse(run.result).items[0]).toMatchObject({
      issueNumber: 40,
      started: true,
    });
  });

  it('refuses to take an unfinished analysis into work', async () => {
    const { service } = setup({
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 1, status: ImproveRunStatus.Running }),
    });

    await expect(service.startItems(1, 'sonnet')).rejects.toThrow(
      'Анализ ещё не завершён',
    );
  });

  it('lists issues of any label when asked for all', async () => {
    const { service, github } = setup();
    const listOpenIssues = jest.fn().mockResolvedValue([]);

    Object.assign(github, { listOpenIssues });

    await service.listIssues(undefined, true);
    await service.listIssues();

    expect(listOpenIssues).toHaveBeenNthCalledWith(1, '', 100);
    expect(listOpenIssues).toHaveBeenNthCalledWith(2, 'loop', 100);
  });
});

describe('ImproveService partial issue filing', () => {
  const twoItems = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      categories: ['security', 'performance'],
      autoCreate: false,
      ...extra,
      items: [
        { category: 'security', title: 'First', risk: 'low', body: 'x' },
        { category: 'performance', title: 'Second', risk: 'low', body: 'y' },
      ],
    });

  const failSecond = (github: { createIssue: jest.Mock }) => {
    github.createIssue
      .mockResolvedValueOnce({ number: 41, missingLabels: [] })
      .mockRejectedValueOnce(new Error('403 rate limit'));
  };

  it('finishes an auto-create analysis as Analyzed when filing fails', async () => {
    const run = {
      id: 1,
      userId: 3,
      status: ImproveRunStatus.Running,
      result: JSON.stringify({
        categories: ['security', 'performance'],
        autoCreate: true,
      }),
    } as Record<string, unknown>;
    const { service, github, storage } = setup();
    const backlog = JSON.parse(twoItems());
    Object.assign(storage, {
      delete: jest.fn().mockResolvedValue(undefined),
      findOwned: jest.fn().mockResolvedValue({ id: 7 }),
      readBytes: jest.fn().mockResolvedValue(
        zipSync({
          'loop-backlog.json': strToU8(JSON.stringify(backlog)),
        }),
      ),
    });
    failSecond(github);

    await service.finishAnalysis(run as never, 7);

    expect(run.status).toBe(ImproveRunStatus.Analyzed);
    expect(run.error).toBeUndefined();
    expect(run.note).toContain('403 rate limit');
    expect(JSON.parse(run.result as string).items[0].issueNumber).toBe(41);
  });

  it('files only the remaining items on retry and starts the filed one', async () => {
    const run = { id: 1, userId: 3, model: 'sonnet', result: twoItems() };
    const { filing, github } = setup({
      findOne: jest.fn().mockResolvedValue({
        ...run,
        status: ImproveRunStatus.Analyzed,
      }),
    });
    failSecond(github);
    await expect(filing.fileProposals(run as never)).rejects.toThrow();

    const analyzed = {
      ...run,
      status: ImproveRunStatus.Analyzed,
    };
    const { service: retry, github: github2 } = setup({
      findOne: jest.fn().mockResolvedValue(analyzed),
    });
    github2.createIssue.mockResolvedValueOnce({
      number: 42,
      missingLabels: [],
    });
    const startRun = jest
      .spyOn(retry, 'startRun')
      .mockResolvedValue({} as never);

    await retry.startItems(1, 'opus');

    expect(github2.createIssue).toHaveBeenCalledTimes(1);
    expect(startRun).toHaveBeenCalledWith(3, 41, 'opus');
    expect(startRun).toHaveBeenCalledWith(3, 42, 'opus');
  });
});

describe('ImproveService start concurrency', () => {
  it('starts the titles lookup and the base-SHA lookup before either resolves', async () => {
    const { service, github } = setup();
    let releaseTitles!: (v: unknown[]) => void;
    let releaseSha!: (v: string) => void;

    github.listIssueTitles.mockReturnValue(
      new Promise((resolve) => (releaseTitles = resolve)),
    );
    github.getBranchSha.mockReturnValue(
      new Promise((resolve) => (releaseSha = resolve)),
    );

    const started = service.startAnalysis(3, 'sonnet');

    await new Promise((resolve) => setImmediate(resolve));
    expect(github.listIssueTitles).toHaveBeenCalledTimes(1);
    expect(github.getBranchSha).toHaveBeenCalledTimes(1);

    releaseTitles([]);
    releaseSha('base-sha');

    await expect(started).resolves.toMatchObject({ jobId: 321 });
  });

  it('fetches the issue and the base SHA together and creates nothing for a closed issue', async () => {
    const { service, github, storage, workers } = setup();
    let releaseIssue!: (v: unknown) => void;

    const getIssue = jest.fn(
      () => new Promise((resolve) => (releaseIssue = resolve)),
    );

    Object.assign(github, { getIssue });

    const started = service.startRun(3, 7, 'sonnet');
    const assertion = expect(started).rejects.toThrow('не открытая задача');

    await new Promise((resolve) => setImmediate(resolve));
    expect(getIssue).toHaveBeenCalledTimes(1);
    expect(github.getBranchSha).toHaveBeenCalledTimes(1);

    releaseIssue({ number: 7, title: 't', body: '', state: 'closed' });
    await assertion;
    expect(storage.createFromBuffer).not.toHaveBeenCalled();
    expect(workers.create).not.toHaveBeenCalled();
  });
});

describe('ImproveService in-process start guard', () => {
  const openIssue = (number: number) => ({
    number,
    title: 't',
    body: '',
    state: 'open',
    isPull: false,
  });

  it('lets only one of two concurrent analyses reach the worker', async () => {
    const { service, github, workers } = setup();
    let release!: (v: Uint8Array) => void;

    github.downloadZipball.mockReturnValue(
      new Promise<Uint8Array>((resolve) => (release = resolve)),
    );

    const first = service.startAnalysis(3, 'sonnet');

    await new Promise((resolve) => setImmediate(resolve));
    await expect(service.startAnalysis(3, 'sonnet')).rejects.toThrow(
      'Анализ уже выполняется',
    );

    release(zipSync({ 'o-r-sha/a.ts': strToU8('one') }));
    await first;
    expect(workers.create).toHaveBeenCalledTimes(1);
  });

  it('lets only one of two concurrent runs for the same issue through, but not for different issues', async () => {
    const { service, github, workers } = setup();
    let release!: (v: Uint8Array) => void;

    Object.assign(github, {
      getIssue: jest.fn(async (n: number) => openIssue(n)),
    });
    github.downloadZipball.mockReturnValue(
      new Promise<Uint8Array>((resolve) => (release = resolve)),
    );

    const a = service.startRun(3, 7, 'sonnet');
    const b = service.startRun(3, 8, 'sonnet');

    await new Promise((resolve) => setImmediate(resolve));
    await expect(service.startRun(3, 7, 'sonnet')).rejects.toThrow(
      'уже выполняется',
    );

    release(zipSync({ 'o-r-sha/a.ts': strToU8('one') }));
    await Promise.all([a, b]);
    expect(workers.create).toHaveBeenCalledTimes(2);
  });

  it('releases the key after a failure', async () => {
    const { service, github, workers } = setup();

    github.downloadZipball.mockRejectedValueOnce(new Error('boom'));
    await expect(service.startAnalysis(3, 'sonnet')).rejects.toThrow('boom');
    await expect(service.startAnalysis(3, 'sonnet')).resolves.toBeDefined();
    expect(workers.create).toHaveBeenCalledTimes(1);
  });
});
