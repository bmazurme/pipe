import { UsageService } from './usage.service';

const NOW = new Date('2026-10-30T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function setup(jobs: Array<Record<string, unknown>>) {
  const jobRepo = { find: jest.fn().mockResolvedValue(jobs) };
  const improve = { find: jest.fn().mockResolvedValue([]) };
  const lab = { find: jest.fn().mockResolvedValue([]) };
  const service = new UsageService(
    jobRepo as never,
    improve as never,
    lab as never,
  );

  return { service, jobRepo, improve, lab };
}

describe('UsageService', () => {
  it("reads only this account's jobs of the window, and only the columns it needs", async () => {
    const { service, jobRepo } = setup([]);

    const report = await service.report(7, 30, NOW);
    const query = jobRepo.find.mock.calls[0][0];

    expect(query.where.userId).toBe(7);
    expect(query.where.createdAt.value.getTime()).toBe(
      NOW.getTime() - 30 * DAY,
    );
    expect(query.select.logs).toBeUndefined();
    expect(query.select.usage).toBe(true);
    expect(report.from).toBe(new Date(NOW.getTime() - 30 * DAY).toISOString());
    expect(report.to).toBe(NOW.toISOString());
  });

  it('does not look up runs when there are no jobs, and scopes the run lookup to the account', async () => {
    const empty = setup([]);
    await empty.service.report(7, 7, NOW);

    expect(empty.improve.find).not.toHaveBeenCalled();

    const some = setup([
      {
        id: 1,
        model: 'sonnet',
        status: 'succeeded',
        taskKey: null,
        startedAt: null,
        finishedAt: null,
        createdAt: NOW,
        usage: null,
      },
    ]);
    await some.service.report(7, 7, NOW);

    expect(some.improve.find.mock.calls[0][0].where.userId).toBe(7);
    expect(some.lab.find.mock.calls[0][0].where.userId).toBe(7);
  });

  it('joins a job to its Improve run and carries the pull request over', async () => {
    const { service, improve } = setup([
      {
        id: 1,
        model: 'sonnet',
        status: 'succeeded',
        taskKey: 'improve:12',
        startedAt: null,
        finishedAt: null,
        createdAt: NOW,
        usage: {
          costUsd: 0.4,
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
      },
    ]);
    improve.find.mockResolvedValue([
      {
        id: 3,
        jobId: 1,
        kind: 'issue',
        issueNumber: 12,
        issueTitle: 'Do X',
        status: 'pr_open',
        prNumber: 40,
        prUrl: 'https://gh/pr/40',
      },
    ]);

    const report = await service.report(7, 30, NOW);

    expect(report.tasks[0]).toMatchObject({
      key: 'improve:12',
      title: 'Issue #12: Do X',
      prNumber: 40,
      costUsd: 0.4,
      tokens: 15,
    });
  });
});
