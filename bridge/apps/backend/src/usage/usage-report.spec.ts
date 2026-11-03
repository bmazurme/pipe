import { buildUsageReport, UsageJob, UsageRun } from './usage-report';

const RANGE = {
  from: new Date('2026-10-01T00:00:00Z'),
  to: new Date('2026-10-30T00:00:00Z'),
};
const at = (day: number, hour = 0) => new Date(Date.UTC(2026, 9, day, hour));

const usage = (costUsd: number | null, tokens = 100) => ({
  costUsd,
  inputTokens: tokens,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
});

const job = (id: number, over: Partial<UsageJob> = {}): UsageJob => ({
  id,
  model: 'sonnet',
  status: 'succeeded',
  taskKey: null,
  startedAt: at(2, 10),
  finishedAt: new Date(at(2, 10).getTime() + 90_000),
  createdAt: at(2, 9),
  usage: usage(0.5),
  ...over,
});

const improveRun = (jobId: number, over: Partial<UsageRun> = {}): UsageRun => ({
  jobId,
  kind: 'improve',
  runKind: 'issue',
  issueNumber: 7,
  runId: jobId,
  title: 'Cache lists',
  status: 'pr_open',
  prNumber: null,
  prUrl: null,
  ...over,
});

describe('buildUsageReport', () => {
  it('is all zeros for no jobs', () => {
    const report = buildUsageReport([], [], RANGE);

    expect(report.totals).toEqual({
      jobs: 0,
      failed: 0,
      machineSeconds: 0,
      tokens: 0,
      costUsd: 0,
      withoutCost: 0,
    });
    expect(report.tasks).toEqual([]);
    expect(report.costPerPullRequest).toBeNull();
  });

  it('sums machine time, tokens and cost, and counts failures and jobs with no cost', () => {
    const report = buildUsageReport(
      [
        job(1),
        job(2, { status: 'failed', usage: usage(null, 50) }),
        job(3, { startedAt: null, finishedAt: null, usage: null }),
      ],
      [],
      RANGE,
    );

    expect(report.totals).toEqual({
      jobs: 3,
      failed: 1,
      machineSeconds: 180,
      tokens: 150,
      costUsd: 0.5,
      withoutCost: 2,
    });
  });

  it("puts an issue's CI repairs into that issue's cost, and reports the pull request", () => {
    const report = buildUsageReport(
      [
        job(1, { usage: usage(1) }),
        job(2, { usage: usage(0.25), createdAt: at(3) }),
      ],
      [
        improveRun(1),
        improveRun(2, {
          runKind: 'repair',
          prNumber: 55,
          prUrl: 'https://gh/pr/55',
          status: 'pr_updated',
        }),
      ],
      RANGE,
    );

    expect(report.tasks).toHaveLength(1);
    expect(report.tasks[0]).toMatchObject({
      key: 'improve:7',
      kind: 'improve',
      title: 'Issue #7: Cache lists',
      jobs: 2,
      costUsd: 1.25,
      prNumber: 55,
      prUrl: 'https://gh/pr/55',
      outcome: 'pr_updated',
    });
    expect(report.pullRequests).toBe(1);
    expect(report.costPerPullRequest).toBe(1.25);
  });

  it('keeps analyses in one row, Lab runs apart, and plain parcels by their task key', () => {
    const report = buildUsageReport(
      [
        job(1, { usage: usage(0.1) }),
        job(2, { usage: usage(0.1) }),
        job(3, { usage: usage(0.4) }),
        job(4, { usage: usage(0.2), taskKey: '9001:12' }),
        job(5, { usage: usage(0.3), taskKey: '9001:12' }),
        job(6, { usage: usage(0.05) }),
      ],
      [
        improveRun(1, { runKind: 'analysis', issueNumber: null }),
        improveRun(2, { runKind: 'analysis', issueNumber: null }),
        {
          jobId: 3,
          kind: 'lab',
          issueNumber: null,
          runId: 9,
          title: 'Migrate X',
          status: 'pr_open',
          prNumber: 3,
          prUrl: 'u',
        },
      ],
      RANGE,
    );

    expect(
      report.tasks.map((task) => [task.key, task.kind, task.jobs]),
    ).toEqual([
      ['9001:12', 'parcel', 2],
      ['lab:9', 'lab', 1],
      ['analysis', 'analysis', 2],
      ['job:6', 'parcel', 1],
    ]);
  });

  it('splits by model, dearest first, and caps the task list', () => {
    const jobs = [
      job(1, { model: 'sonnet', usage: usage(0.2) }),
      job(2, { model: 'opus', usage: usage(2) }),
      job(3, { model: 'opus', usage: usage(1) }),
    ];
    const report = buildUsageReport(jobs, [], RANGE, 2);

    expect(
      report.byModel.map((row) => [row.model, row.jobs, row.costUsd]),
    ).toEqual([
      ['opus', 2, 3],
      ['sonnet', 1, 0.2],
    ]);
    expect(report.tasks).toHaveLength(2);
    expect(report.tasks[0].costUsd).toBe(2);
  });

  it('shows the newest job state for a task and rounds floating-point dust away', () => {
    const report = buildUsageReport(
      [
        job(1, { usage: usage(0.1), createdAt: at(2) }),
        job(2, { usage: usage(0.2), createdAt: at(5) }),
      ],
      [
        improveRun(1, { status: 'failed' }),
        improveRun(2, { status: 'pr_open', prNumber: 8, prUrl: 'u' }),
      ],
      RANGE,
    );

    expect(report.tasks[0].outcome).toBe('pr_open');
    expect(report.tasks[0].costUsd).toBe(0.3);
    expect(report.tasks[0].firstAt).toBe(at(2).toISOString());
    expect(report.tasks[0].lastAt).toBe(at(5).toISOString());
  });

  describe('byRoute', () => {
    it('groups routed runs by decision with failures, cost and pull requests', () => {
      const report = buildUsageReport(
        [
          job(1, { usage: usage(1) }),
          job(2, { usage: usage(2), status: 'failed' }),
          job(3, { usage: usage(0.5) }),
          job(4, { usage: usage(0.25) }),
          job(5, { usage: usage(9) }),
        ],
        [
          improveRun(1, {
            issueNumber: 1,
            prNumber: 10,
            routing: {
              model: 'haiku',
              source: 'classifier',
              reason: 'r',
              tier: 2,
            },
          }),
          improveRun(2, {
            issueNumber: 2,
            routing: {
              model: 'haiku',
              source: 'classifier',
              reason: 'r',
              tier: 2,
            },
          }),
          improveRun(3, {
            issueNumber: 3,
            prNumber: 11,
            routing: { model: 'opus', source: 'rule', reason: 'r', rule: 'db' },
          }),
          improveRun(4, {
            issueNumber: 4,
            routing: { model: 'sonnet', source: 'fallback', reason: 'r' },
          }),
          improveRun(5, { issueNumber: 5 }),
        ],
        RANGE,
      );

      expect(
        report.byRoute.map((row) => [
          row.route,
          row.label,
          row.jobs,
          row.failed,
          row.costUsd,
          row.pullRequests,
        ]),
      ).toEqual([
        ['tier:2', 'Ярус 2', 2, 1, 3, 1],
        ['rule:db', 'Правило «db»', 1, 0, 0.5, 1],
        ['fallback', 'Не определён → sonnet', 1, 0, 0.25, 0],
      ]);
      expect(report.byModel[0].jobs).toBe(5);
    });
  });

  describe('byDay', () => {
    const atTime = (day: number, hour: number, minute: number) =>
      new Date(Date.UTC(2026, 9, day, hour, minute));

    it('groups by UTC date of createdAt, newest first, summing to the totals', () => {
      const report = buildUsageReport(
        [
          job(1, { createdAt: atTime(3, 23, 59), usage: usage(1) }),
          job(2, {
            createdAt: atTime(4, 0, 1),
            usage: usage(2),
            status: 'failed',
          }),
          job(3, { createdAt: atTime(4, 12, 0), usage: usage(0.5) }),
        ],
        [],
        RANGE,
      );

      expect(
        report.byDay.map((row) => [row.day, row.jobs, row.failed, row.costUsd]),
      ).toEqual([
        ['2026-10-04', 2, 1, 2.5],
        ['2026-10-03', 1, 0, 1],
      ]);
      expect(report.byDay.reduce((sum, row) => sum + row.jobs, 0)).toBe(
        report.totals.jobs,
      );
    });

    it('is empty for no jobs', () => {
      expect(buildUsageReport([], [], RANGE).byDay).toEqual([]);
    });
  });
});
