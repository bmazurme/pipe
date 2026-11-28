import { ImproveQualityService } from './improve-quality.service';

const NOW = new Date('2026-11-27T12:00:00Z');
const iso = (hoursAgo: number) =>
  new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();

const run = (over: Record<string, unknown> = {}) => ({
  id: 1,
  kind: 'issue',
  trigger: 'manual',
  prNumber: 100,
  jobId: 11,
  model: 'haiku',
  routing: { tier: 2 },
  ...over,
});

function make(
  options: {
    runs?: object[];
    known?: object[];
    jobs?: object[];
    pull?: object;
    ci?: string;
    titles?: Array<{ number: number; title: string }>;
    configured?: boolean;
    origin?: object | null;
  } = {},
) {
  const runs = {
    find: jest.fn().mockResolvedValue(options.runs ?? [run()]),
    findOne: jest.fn().mockResolvedValue(options.origin ?? null),
    createQueryBuilder: jest.fn(),
  };
  const upserts: object[] = [];
  const outcomes = {
    find: jest.fn().mockResolvedValue(options.known ?? []),
    upsert: jest.fn(async (row: object) => {
      upserts.push(row);
    }),
  };
  const jobs = {
    find: jest
      .fn()
      .mockResolvedValue(options.jobs ?? [{ id: 11, usage: { costUsd: 0.4 } }]),
  };
  const github = {
    isConfigured: jest.fn().mockReturnValue(options.configured ?? true),
    pullTimes: jest.fn().mockResolvedValue(
      options.pull ?? {
        open: false,
        merged: true,
        createdAt: iso(10),
        mergedAt: iso(9),
        closedAt: iso(9),
      },
    ),
    firstCommitSha: jest.fn().mockResolvedValue('abc'),
    ciState: jest.fn().mockResolvedValue(options.ci ?? 'success'),
    recentMergedTitles: jest.fn().mockResolvedValue(options.titles ?? []),
  };
  const service = new ImproveQualityService(
    runs as never,
    outcomes as never,
    jobs as never,
    github as never,
  );

  return { service, upserts, github, outcomes };
}

describe('ImproveQualityService.sync — A9 escalation', () => {
  it('knows a pull request that came from a step up after a failed run, and counts what the failed run cost', async () => {
    const { service, upserts } = make({
      runs: [run({ id: 5, model: 'sonnet', jobId: 21, escalatedFromRunId: 4 })],
      origin: {
        id: 4,
        model: 'haiku',
        jobId: 20,
        kind: 'issue',
        prNumber: null,
      },
      jobs: [
        { id: 21, usage: { costUsd: 0.8 } },
        { id: 20, usage: { costUsd: 0.3 } },
      ],
    });

    await service.sync(1, NOW);

    expect(upserts[0]).toMatchObject({
      model: 'sonnet',
      escalatedFrom: 'haiku',
    });
    expect((upserts[0] as { costUsd: number }).costUsd).toBeCloseTo(1.1);
  });

  it('knows a step-up CI repair, and does not count it as one more automatic repair', async () => {
    const { service, upserts } = make({
      runs: [
        run({ id: 1, escalatedFromRunId: null }),
        run({
          id: 2,
          kind: 'repair',
          trigger: 'ci',
          jobId: 12,
          escalatedFromRunId: null,
        }),
        run({
          id: 3,
          kind: 'repair',
          trigger: 'ci',
          jobId: 13,
          escalatedFromRunId: null,
        }),
        run({
          id: 4,
          kind: 'repair',
          trigger: 'ci',
          jobId: 14,
          model: 'sonnet',
          escalatedFromRunId: 3,
        }),
      ],
      jobs: [
        { id: 11, usage: { costUsd: 0.1 } },
        { id: 12, usage: { costUsd: 0.1 } },
        { id: 13, usage: { costUsd: 0.1 } },
        { id: 14, usage: { costUsd: 0.5 } },
      ],
    });

    await service.sync(1, NOW);

    expect(upserts[0]).toMatchObject({
      model: 'haiku',
      ciRepairs: 2,
      escalatedFrom: 'haiku',
      runId: 1,
    });
    expect((upserts[0] as { costUsd: number }).costUsd).toBeCloseTo(0.8);
  });

  it('leaves escalatedFrom empty for work that never escalated', async () => {
    const { service, upserts } = make();

    await service.sync(1, NOW);

    expect(upserts[0]).toMatchObject({ escalatedFrom: null });
  });
});

describe('ImproveQualityService.sync', () => {
  it('records a merged pull request with its first CI, cost, model and tier', async () => {
    const { service, upserts } = make();

    await expect(service.sync(1, NOW)).resolves.toEqual({
      checked: 1,
      remaining: 0,
    });
    expect(upserts[0]).toMatchObject({
      userId: 1,
      prNumber: 100,
      runId: 1,
      model: 'haiku',
      tier: 2,
      state: 'merged',
      firstCi: 'success',
      ciRepairs: 0,
      costUsd: 0.4,
      reverted: false,
    });
  });

  it('counts CI repairs and adds up the cost of every run of the pull request', async () => {
    const { service, upserts } = make({
      runs: [
        run(),
        run({ id: 2, kind: 'repair', trigger: 'ci', jobId: 12 }),
        run({ id: 3, kind: 'repair', trigger: 'chat', jobId: 13 }),
      ],
      jobs: [
        { id: 11, usage: { costUsd: 0.4 } },
        { id: 12, usage: { costUsd: 0.1 } },
        { id: 13, usage: null },
      ],
    });

    await service.sync(1, NOW);

    expect(upserts[0]).toMatchObject({ ciRepairs: 1, runId: 1 });
    expect((upserts[0] as { costUsd: number }).costUsd).toBeCloseTo(0.5);
  });

  it('has no cost when no run reported one', async () => {
    const { service, upserts } = make({ jobs: [{ id: 11, usage: null }] });

    await service.sync(1, NOW);

    expect((upserts[0] as { costUsd: number | null }).costUsd).toBeNull();
  });

  it('does not call a running CI a failure: the first result stays unknown until it finishes', async () => {
    const { service, upserts } = make({
      ci: 'pending',
      pull: {
        open: true,
        merged: false,
        createdAt: iso(1),
        mergedAt: null,
        closedAt: null,
      },
    });

    await service.sync(1, NOW);

    expect(upserts[0]).toMatchObject({ state: 'open', firstCi: null });
  });

  it('keeps a first-CI result it already has instead of asking again (later commits would change the answer)', async () => {
    const { service, github, upserts } = make({
      known: [
        {
          prNumber: 100,
          state: 'open',
          firstCi: 'failure',
          mergedAt: null,
          checkedAt: new Date(NOW.getTime() - 60_000),
        },
      ],
      pull: {
        open: true,
        merged: false,
        createdAt: iso(1),
        mergedAt: null,
        closedAt: null,
      },
    });

    await service.sync(1, NOW);

    expect(github.firstCommitSha).not.toHaveBeenCalled();
    expect(upserts[0]).toMatchObject({ firstCi: 'failure' });
  });

  it('marks a pull request that a later one reverted', async () => {
    const { service, upserts } = make({
      titles: [{ number: 150, title: 'Revert "improve: x (#100)"' }],
    });

    await service.sync(1, NOW);

    expect(upserts[0]).toMatchObject({ reverted: true });
  });

  it('maps an unmerged closed pull request to closed', async () => {
    const { service, upserts } = make({
      pull: {
        open: false,
        merged: false,
        createdAt: iso(5),
        mergedAt: null,
        closedAt: iso(4),
      },
    });

    await service.sync(1, NOW);

    expect(upserts[0]).toMatchObject({ state: 'closed', mergedAt: null });
  });

  it('leaves a settled pull request alone', async () => {
    const { service, github, upserts } = make({
      known: [
        {
          prNumber: 100,
          state: 'closed',
          firstCi: 'failure',
          mergedAt: null,
          checkedAt: new Date(0),
        },
      ],
    });

    await expect(service.sync(1, NOW)).resolves.toEqual({
      checked: 0,
      remaining: 0,
    });
    expect(github.pullTimes).not.toHaveBeenCalled();
    expect(upserts).toEqual([]);
  });

  it('skips a pull request GitHub cannot read and goes on with the rest', async () => {
    const { service, github, upserts } = make({
      runs: [run(), run({ id: 2, prNumber: 101 })],
    });

    github.pullTimes.mockRejectedValueOnce(new Error('rate limit'));

    await expect(service.sync(1, NOW)).resolves.toEqual({
      checked: 1,
      remaining: 0,
    });
    expect(upserts).toHaveLength(1);
  });

  it('does nothing without GitHub configured', async () => {
    const { service, github } = make({ configured: false });

    await expect(service.sync(1, NOW)).resolves.toEqual({
      checked: 0,
      remaining: 0,
    });
    expect(github.pullTimes).not.toHaveBeenCalled();
  });
});

describe('ImproveQualityService — A10 work time and model cards', () => {
  it('records how long the agent worked: the jobs’ own clock, the cheap attempt a step up came after included', async () => {
    const { service, upserts } = make({
      runs: [run({ id: 5, model: 'sonnet', jobId: 21, escalatedFromRunId: 4 })],
      origin: {
        id: 4,
        model: 'haiku',
        jobId: 20,
        kind: 'issue',
        prNumber: null,
      },
      jobs: [
        {
          id: 21,
          usage: { costUsd: 0.8 },
          startedAt: new Date('2026-12-01T10:00:00Z'),
          finishedAt: new Date('2026-12-01T10:10:00Z'),
        },
        {
          id: 20,
          usage: { costUsd: 0.3 },
          startedAt: new Date('2026-12-01T09:00:00Z'),
          finishedAt: new Date('2026-12-01T09:05:00Z'),
        },
      ],
    });

    await service.sync(1, NOW);

    expect((upserts[0] as { workSeconds: number }).workSeconds).toBe(900);
  });

  it('records nothing when no job has a finish time', async () => {
    const { service, upserts } = make({
      jobs: [{ id: 11, usage: { costUsd: 0.4 } }],
    });

    await service.sync(1, NOW);

    expect(
      (upserts[0] as { workSeconds: number | null }).workSeconds,
    ).toBeNull();
  });

  it('builds the cards and the advice from the stored outcomes and the router table it is given', async () => {
    const { service, outcomes } = make();
    const merged = (n: number) => ({
      prNumber: n,
      model: 'haiku',
      tier: 2,
      state: 'merged',
      firstCi: 'success',
      ciRepairs: 0,
      costUsd: 0.2,
      openedAt: new Date(),
      mergedAt: new Date(),
      reverted: false,
      escalatedFrom: null,
      workSeconds: 300,
    });

    outcomes.find.mockResolvedValue([1, 2, 3, 4, 5, 6].map(merged));

    const cards = await service.modelCards(1, 90, {
      1: 'haiku',
      2: 'haiku',
      3: 'haiku',
      4: 'opus',
    });

    expect(cards.cells).toEqual([
      expect.objectContaining({
        model: 'haiku',
        tier: 2,
        merged: 6,
        medianWorkMinutes: 5,
        verdict: 'solid',
      }),
    ]);
    expect(cards.advice.find((a) => a.tier === 2)?.status).toBe('keep');
  });
});
