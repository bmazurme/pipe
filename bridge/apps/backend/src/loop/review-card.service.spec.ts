import { ReviewCardService } from './review-card.service';

function setup() {
  const github = {
    getPull: jest.fn().mockResolvedValue({
      number: 12,
      title: 'Add the thing',
      htmlUrl: 'https://github.com/o/r/pull/12',
      baseRef: 'main',
      headSha: 'abc123',
      mergeable: true,
      body: '**Проверка перед PR:** пройдена (x).',
    }),
    listPullFileStats: jest.fn().mockResolvedValue([
      { path: 'infra/a.sh', additions: 4, deletions: 1, status: 'modified' },
      {
        path: '.github/workflows/ci.yml',
        additions: 1,
        deletions: 0,
        status: 'modified',
      },
    ]),
    ciState: jest.fn().mockResolvedValue('success'),
  };
  const runs = {
    find: jest.fn().mockResolvedValue([
      {
        id: 1,
        kind: 'issue',
        trigger: 'auto',
        model: 'haiku',
        routing: { tier: 2 },
        jobId: 10,
        escalatedFromRunId: null,
      },
      {
        id: 2,
        kind: 'repair',
        trigger: 'ci',
        model: 'haiku',
        routing: null,
        jobId: null,
        escalatedFromRunId: null,
      },
    ]),
  };
  const jobs = {
    find: jest.fn().mockResolvedValue([
      {
        id: 10,
        usage: { costUsd: 0.5 },
        startedAt: new Date('2026-11-28T10:00:00Z'),
        finishedAt: new Date('2026-11-28T10:06:00Z'),
      },
    ]),
  };
  const config = { get: jest.fn() };

  return {
    service: new ReviewCardService(
      github as never,
      runs as never,
      jobs as never,
      config as never,
    ),
    github,
    runs,
    jobs,
    config,
  };
}

describe('ReviewCardService', () => {
  it('gathers the pull request, its files, CI and the runs behind it into one card', async () => {
    const { service, runs, jobs } = setup();

    const card = await service.build(12);

    expect(runs.find).toHaveBeenCalledWith({ where: { prNumber: 12 } });
    expect(jobs.find).toHaveBeenCalledTimes(1);
    expect(card).toMatchObject({
      number: 12,
      risk: { level: 'high' },
      diff: { files: 2, additions: 5, deletions: 1 },
      run: {
        model: 'haiku',
        tier: 2,
        attempts: 2,
        ciRepairs: 1,
        workMinutes: 6,
        costUsd: 0.5,
      },
    });
    expect(card.checked).toEqual(
      expect.arrayContaining([
        'CI зелёный',
        'проверка воркера перед PR пройдена',
      ]),
    );
    expect(card.notChecked.join(' ')).toContain(
      'защищённые пути (.github/workflows/ci.yml)',
    );
  });

  it('does not ask for jobs when no run has one', async () => {
    const { service, runs, jobs } = setup();

    runs.find.mockResolvedValue([]);

    await expect(service.build(12)).resolves.toMatchObject({ run: null });
    expect(jobs.find).not.toHaveBeenCalled();
  });

  it('links to the Improve page of this bridge only when its address is known', () => {
    const { service, config } = setup();

    expect(service.improveUrl()).toBeUndefined();

    config.get.mockReturnValue('https://bridge.example/');

    expect(service.improveUrl()).toBe('https://bridge.example/improve');
  });
});
