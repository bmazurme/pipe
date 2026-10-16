import { ImproveIssueFilingService } from './improve-issue-filing.service';

function setup() {
  const runs = {
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn(async (run: object) => ({ id: 1, ...run })),
  };
  const github = {
    isReady: jest.fn().mockReturnValue(true),
    listIssueTitles: jest.fn().mockResolvedValue([]),
    createIssue: jest.fn(async () => ({
      number: 40,
      missingLabels: [] as string[],
    })),
  };
  const appLogs = { record: jest.fn() };
  const service = new ImproveIssueFilingService(
    runs as never,
    github as never,
    appLogs as never,
  );

  return { service, runs, github, appLogs };
}

describe('ImproveIssueFilingService', () => {
  it('warns, in the run note and the app log, when GitHub dropped the loop label', async () => {
    const { service, github } = setup();
    github.createIssue.mockResolvedValue({
      number: 41,
      missingLabels: ['loop'],
    });
    const run = {
      id: 1,
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

    const summary = await service.fileProposals(run as never);

    expect(summary).toContain('без метки loop: #41');
    expect(summary).toContain('Issues: write');
  });
});

describe('ImproveIssueFilingService partial issue filing', () => {
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

  it('keeps the issues already filed when GitHub fails midway', async () => {
    const run = { id: 1, userId: 3, result: twoItems() };
    const { service, github, runs } = setup();
    failSecond(github);

    await expect(service.fileProposals(run as never)).rejects.toThrow(
      /Second.*403 rate limit.*уже создано: 1/,
    );

    const stored = JSON.parse(run.result);
    expect(stored.items[0].issueNumber).toBe(41);
    expect(stored.items[1].issueNumber).toBeUndefined();
    expect(runs.save).toHaveBeenCalledWith(run);
  });
});
