import { ImproveIssueFilingService } from './improve-issue-filing.service';

function setup() {
  const runs = {
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn(async (run: object) => ({ id: 1, ...run })),
  };
  const github = {
    isReady: jest.fn().mockReturnValue(true),
    listIssueTitles: jest.fn().mockResolvedValue([]),
    listOpenIssues: jest.fn().mockResolvedValue([]),
    createIssue: jest.fn(async () => ({
      number: 40,
      missingLabels: [] as string[],
    })),
  };
  const appLogs = { record: jest.fn() };
  // No row: the account never saved settings, so the defaults (minimum value 3, 3 open per direction, 5 a day) apply.
  const settings = { findOne: jest.fn().mockResolvedValue(null) };
  const service = new ImproveIssueFilingService(
    runs as never,
    github as never,
    appLogs as never,
    settings as never,
  );

  return { service, runs, github, appLogs, settings };
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

describe('ImproveIssueFilingService.createManualIssue', () => {
  it('files a loop-labelled issue without starting a run', async () => {
    const { service, github } = setup();
    github.createIssue.mockResolvedValue({
      number: 55,
      htmlUrl: 'https://github.com/acme/repo/issues/55',
      missingLabels: [],
    } as never);

    const result = await service.createManualIssue({
      title: 'Idea',
      body: 'Details',
    });

    expect(github.createIssue).toHaveBeenCalledWith({
      title: 'Idea',
      body: 'Details',
      labels: ['loop'],
    });
    expect(result).toEqual({
      number: 55,
      htmlUrl: 'https://github.com/acme/repo/issues/55',
      missingLabels: [],
    });
  });

  it('starts a run on the new issue when asked and reports dropped labels', async () => {
    const { service, github } = setup();
    github.createIssue.mockResolvedValue({
      number: 56,
      htmlUrl: 'u',
      missingLabels: ['loop'],
    } as never);
    const start = jest.fn().mockResolvedValue({ id: 9 });

    const result = await service.createManualIssue({ title: 'Idea' }, start);

    expect(start).toHaveBeenCalledWith(56);
    expect(result.run).toEqual({ id: 9 });
    expect(result.missingLabels).toEqual(['loop']);
  });

  it('propagates a GitHub error and starts nothing', async () => {
    const { service, github } = setup();
    github.createIssue.mockRejectedValue(new Error('boom'));
    const start = jest.fn();

    await expect(
      service.createManualIssue({ title: 'Idea' }, start),
    ).rejects.toThrow('boom');
    expect(start).not.toHaveBeenCalled();
  });

  describe('the filing brake', () => {
    const runWith = (items: Array<Record<string, unknown>>) => ({
      id: 1,
      userId: 3,
      result: JSON.stringify({ categories: [], autoCreate: true, items }),
      note: null as string | null,
    });
    const proposal = (title: string, category: string, value: number) => ({
      category,
      title,
      risk: 'low',
      body: 'b',
      value,
      effort: 'm',
    });

    it('files the best proposals first, holds back the weak ones, and records why', async () => {
      const { service, github } = setup();
      const run = runWith([
        proposal('weak', 'docs', 2),
        proposal('good', 'tests', 4),
      ]);

      const summary = await service.fileProposals(run as never);

      expect(github.createIssue).toHaveBeenCalledTimes(1);
      expect((github.createIssue.mock.calls as unknown[][])[0][0]).toEqual(
        expect.objectContaining({ title: 'good' }),
      );
      expect(summary).toContain('придержано по лимитам: 1');

      const stored = JSON.parse(run.result);

      expect(stored.items[0].skipped).toBe('польза 2 ниже минимума 3');
      expect(stored.items[1].issueNumber).toBe(40);
    });

    it('counts open issues of a direction and those filed in the last 24 hours', async () => {
      const { service, github } = setup();
      const recent = new Date().toISOString();
      github.listOpenIssues.mockResolvedValue(
        ['a', 'b', 'c'].map(() => ({
          labels: ['loop', 'category:ui'],
          createdAt: recent,
        })),
      );
      const run = runWith([
        proposal('ui again', 'ui', 5),
        proposal('docs', 'docs', 5),
      ]);

      await service.fileProposals(run as never);

      expect(github.createIssue).toHaveBeenCalledTimes(1);
      expect(JSON.parse(run.result).items[0].skipped).toContain(
        'уже 3 открытых',
      );
    });

    it('does not apply the brake to proposals a person ticked by hand', async () => {
      const { service, github } = setup();
      const run = runWith([proposal('weak', 'docs', 1)]);

      await service.fileProposals(run as never, [0]);

      expect(github.createIssue).toHaveBeenCalledTimes(1);
    });

    it('holds nothing back when GitHub cannot say what is open', async () => {
      const { service, github } = setup();
      github.listOpenIssues.mockRejectedValue(new Error('GitHub 502'));
      const run = runWith([proposal('good', 'tests', 4)]);

      await service.fileProposals(run as never);

      expect(github.createIssue).toHaveBeenCalledTimes(1);
    });
  });
});
