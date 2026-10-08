import { ImproveRunStatus } from './entities/improve-run.entity';
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
    createIssue: jest.fn(async () => ({ number: 40 })),
  };
  const storage = {
    createFromBuffer: jest.fn().mockResolvedValue({ id: 99 }),
    delete: jest.fn(),
  };
  const workers = { create: jest.fn().mockResolvedValue({ id: 321 }) };
  const service = new ImproveService(
    runs as never,
    {} as never,
    {} as never,
    github as never,
    storage as never,
    workers as never,
    { send: jest.fn() } as never,
    { query: jest.fn() } as never,
    { record: jest.fn() } as never,
  );

  return { service, runs, github, workers };
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
    const { service, github } = setup();
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

    const summary = await service.createIssuesFromRun(run as never);

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
});
