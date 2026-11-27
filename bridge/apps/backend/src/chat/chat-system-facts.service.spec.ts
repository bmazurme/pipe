import {
  ChatSystemFactsService,
  lastUserMessage,
} from './chat-system-facts.service';

const NOW = new Date('2026-11-27T12:00:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

function setup(
  over: {
    owner?: boolean;
    run?: object | null;
    job?: object | null;
    linkedJob?: object | null;
  } = {},
) {
  const runs = {
    find: jest.fn().mockResolvedValue([
      {
        id: 7,
        kind: 'issue',
        issueNumber: 42,
        issueTitle: 'Fix',
        model: 'haiku',
        error: 'claude exited 1',
        finishedAt: minutesAgo(30),
        prNumber: null,
        createdAt: minutesAgo(40),
        status: 'failed',
      },
    ]),
    count: jest.fn().mockResolvedValue(2),
    findOne: jest
      .fn()
      .mockResolvedValue(over.run === undefined ? null : over.run),
  };
  const jobs = {
    find: jest.fn().mockResolvedValue([
      {
        id: 91,
        model: 'sonnet',
        errorMessage: 'timed out',
        finishedAt: minutesAgo(20),
        taskKey: 'improve:42',
        status: 'failed',
        createdAt: minutesAgo(25),
      },
    ]),
    findOne: jest
      .fn()
      .mockImplementation(async ({ where }: { where: { id: number } }) =>
        where.id === 5
          ? over.job === undefined
            ? null
            : over.job
          : (over.linkedJob ?? null),
      ),
  };
  const workers = {
    find: jest.fn().mockResolvedValue([
      { name: 'red', enabled: true, lastSeenAt: minutesAgo(1) },
      { name: 'green', enabled: true, lastSeenAt: minutesAgo(60) },
      { name: 'off', enabled: false, lastSeenAt: null },
    ]),
  };
  const dataSource = {
    query: jest.fn().mockResolvedValue([]),
    showMigrations: jest.fn().mockResolvedValue(false),
  };
  const appLogs = {
    list: jest.fn().mockResolvedValue([
      {
        event: 'telegram.api_failed',
        level: 'warn',
        message: 'ETIMEDOUT',
        createdAt: minutesAgo(5),
      },
      {
        event: 'http.slow',
        level: 'warn',
        message: 'slow',
        createdAt: minutesAgo(6),
      },
    ]),
  };
  const access = { isOwner: jest.fn().mockResolvedValue(over.owner ?? true) };
  const drift = {
    view: jest.fn().mockResolvedValue({
      status: 'warn',
      items: [
        { id: 'x', level: 'warn', subject: 'ubuntu-red', text: 'old image' },
      ],
    }),
  };
  const service = new ChatSystemFactsService(
    runs as never,
    jobs as never,
    workers as never,
    dataSource as never,
    appLogs as never,
    access as never,
    drift as never,
  );

  return { service, runs, jobs, workers, dataSource, appLogs, access, drift };
}

// The service looks at «now»; the fixtures are placed around a fixed one.
beforeEach(() => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
  });
});
afterEach(() => jest.useRealTimers());

describe('ChatSystemFactsService.forMessage', () => {
  it('takes a snapshot for a question about what is broken, and it carries everything', async () => {
    const { service } = setup();
    const text = (await service.forMessage(1, 'что сломалось?')) as string;

    expect(text).toContain('Improve run #7');
    expect(text).toContain('Worker job #91');
    expect(text).toContain('ubuntu-red: old image');
    expect(text).toContain('Online: red. Not seen recently: green.');
    expect(text).toContain('telegram.api_failed');
    expect(text).not.toContain('http.slow');
    expect(text).toContain('2 run(s) are waiting');
    // a worker switched off is neither online nor «not seen»
    expect(text).not.toContain('off,');
  });

  it('says nothing for a message that is not about the system', async () => {
    const { service, runs } = setup();

    expect(await service.forMessage(1, 'напиши функцию сортировки')).toBeNull();
    expect(runs.find).not.toHaveBeenCalled();
  });

  it('gives nothing to anyone but the owner, and does not even look', async () => {
    const { service, runs, appLogs } = setup({ owner: false });

    expect(await service.forMessage(2, 'что сломалось?')).toBeNull();
    expect(runs.find).not.toHaveBeenCalled();
    expect(appLogs.list).not.toHaveBeenCalled();
  });

  it('answers without a snapshot rather than failing the turn when it cannot be taken', async () => {
    const { service, runs } = setup();

    runs.find.mockRejectedValue(new Error('db down'));

    expect(await service.forMessage(1, 'что сломалось?')).toBeNull();
  });

  it("reads only the account's own runs and jobs", async () => {
    const { service, runs, jobs } = setup();

    await service.forMessage(7, 'что сломалось?');

    expect(runs.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 7 }),
      }),
    );
    expect(jobs.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 7 }),
      }),
    );
  });

  it('does not read the logs of the jobs when listing failures', async () => {
    const { service, jobs } = setup();

    await service.forMessage(1, 'что сломалось?');

    const { select } = jobs.find.mock.calls[0][0] as { select: string[] };

    expect(select).not.toContain('logs');
  });

  it('reports a database it cannot reach', async () => {
    const { service, dataSource } = setup();

    dataSource.query.mockRejectedValue(new Error('refused'));

    expect(await service.forMessage(1, 'что сломалось?')).toContain(
      'cannot reach its database',
    );
  });

  it('copes without a drift service', async () => {
    const { service, drift } = setup();

    drift.view.mockRejectedValue(new Error('no boards'));

    expect(await service.forMessage(1, 'что сломалось?')).toContain('Workers');
  });
});

describe('ChatSystemFactsService.explain', () => {
  const run = {
    id: 5,
    kind: 'issue',
    status: 'failed',
    trigger: 'manual',
    model: 'haiku',
    issueNumber: 12,
    issueTitle: 'Fix it',
    prNumber: null,
    prUrl: null,
    branch: null,
    note: null,
    error: 'boom',
    gateRetries: undefined,
    escalatedFromRunId: undefined,
    createdAt: minutesAgo(10),
    finishedAt: minutesAgo(5),
    jobId: 5,
  };
  const job = {
    id: 5,
    status: 'failed',
    model: 'haiku',
    errorMessage: 'boom',
    logs: 'x'.repeat(10_000),
    createdAt: minutesAgo(10),
    startedAt: minutesAgo(9),
    finishedAt: minutesAgo(5),
    usage: { costUsd: 0.3 },
  };

  it('finds the run and its job by the same number, within the account', async () => {
    const { service, runs, jobs } = setup({ run, job });
    const detail = await service.explain(1, 5);

    expect(detail.run).toMatchObject({
      id: 5,
      gateRetries: 0,
      escalatedFromRunId: null,
    });
    expect(detail.job).toMatchObject({ id: 5, costUsd: 0.3 });
    expect(detail.job!.logs.length).toBe(6000);
    expect(runs.findOne).toHaveBeenCalledWith({ where: { id: 5, userId: 1 } });
    expect(jobs.findOne).toHaveBeenCalledWith({ where: { id: 5, userId: 1 } });
  });

  it('follows a run to its job when that is another number', async () => {
    const { service } = setup({
      run: { ...run, id: 8, jobId: 99 },
      job: null,
      linkedJob: { ...job, id: 99 },
    });
    const detail = await service.explain(1, 8);

    expect(detail.run!.id).toBe(8);
    expect(detail.job!.id).toBe(99);
  });

  it('is empty for a number that is neither', async () => {
    const { service } = setup();

    expect(await service.explain(1, 5)).toMatchObject({ run: null, job: null });
  });
});

describe('ChatSystemFactsService.recent', () => {
  it('merges runs and jobs, newest first, within the limit', async () => {
    const { service } = setup();
    const rows = await service.recent(1, 10);

    expect(rows.map((r) => [r.source, r.id])).toEqual([
      ['worker-job', 91],
      ['improve-run', 7],
    ]);
  });

  it('caps the limit, and passes the status on', async () => {
    const { service, runs } = setup();

    await service.recent(1, 500, 'failed');

    expect(runs.find).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 30,
        where: { userId: 1, status: 'failed' },
      }),
    );
  });
});

describe('lastUserMessage', () => {
  it('is the last thing the user said, or empty', () => {
    expect(
      lastUserMessage([
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
        { role: 'user', content: 'c' },
        { role: 'assistant', content: 'd' },
      ]),
    ).toBe('c');
    expect(lastUserMessage([])).toBe('');
  });
});
