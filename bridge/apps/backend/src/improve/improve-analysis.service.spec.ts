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
  const appLogs = {
    record: jest.fn(),
    summary: jest.fn().mockRejectedValue(new Error('no table')),
    list: jest.fn().mockResolvedValue([]),
  };
  const service = new ImproveService(
    runs as never,
    {} as never,
    {} as never,
    github as never,
    storage as never,
    workers as never,
    { send: jest.fn() } as never,
    { query: jest.fn() } as never,
    appLogs as never,
  );

  return { service, runs, github, workers, storage, appLogs };
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
});
