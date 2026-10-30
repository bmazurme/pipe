import { InboxService } from './inbox.service';

const NOW = new Date('2026-10-30T12:00:00Z');

function setup(
  over: {
    runs?: Array<Record<string, unknown>>;
    githubReady?: boolean;
    getPull?: jest.Mock;
    cards?: unknown;
    failed?: Array<Record<string, unknown>>;
    succeeded?: Array<Record<string, unknown>>;
    active?: Array<Record<string, unknown>>;
    workers?: Array<Record<string, unknown>>;
  } = {},
) {
  const runs = { find: jest.fn().mockResolvedValue(over.runs ?? []) };
  const jobs = {
    find: jest.fn(async (query: { where: { status: unknown } }) => {
      if (query.where.status === 'failed') return over.failed ?? [];
      if (query.where.status === 'succeeded') return over.succeeded ?? [];
      return over.active ?? [];
    }),
  };
  const workers = { find: jest.fn().mockResolvedValue(over.workers ?? []) };
  const questions = {
    listCards: jest.fn().mockResolvedValue(over.cards ?? []),
  };
  const boards = { list: jest.fn().mockResolvedValue([]) };
  const github = {
    isReady: jest.fn().mockReturnValue(over.githubReady ?? true),
    getPull:
      over.getPull ??
      jest
        .fn()
        .mockResolvedValue({ state: 'open', merged: false, headSha: 'h' }),
    ciState: jest.fn().mockResolvedValue('success'),
  };
  const service = new InboxService(
    runs as never,
    jobs as never,
    workers as never,
    questions as never,
    boards as never,
    github as never,
  );

  return { service, runs, jobs, workers, questions, boards, github };
}

const run = (prNumber: number) => ({
  id: prNumber,
  prNumber,
  prUrl: `https://gh/pr/${prNumber}`,
  issueTitle: `Task ${prNumber}`,
  finishedAt: new Date('2026-10-30T10:00:00Z'),
  createdAt: new Date('2026-10-30T09:00:00Z'),
});

describe('InboxService', () => {
  it('lists an open PR with its CI state, and drops one that was merged meanwhile', async () => {
    const getPull = jest
      .fn()
      .mockResolvedValueOnce({ state: 'open', merged: false, headSha: 'a' })
      .mockResolvedValueOnce({ state: 'closed', merged: true, headSha: 'b' });
    const { service } = setup({ runs: [run(1), run(2)], getPull });

    const items = await service.list(7, NOW);

    expect(items.map((item) => [item.id, item.kind])).toEqual([
      ['pr:1', 'pr_ready'],
    ]);
  });

  it('asks GitHub once a minute per PR', async () => {
    const { service, github } = setup({ runs: [run(1)] });

    await service.list(7, NOW);
    await service.list(7, new Date(NOW.getTime() + 30_000));
    await service.list(7, new Date(NOW.getTime() + 61_000));

    expect(github.getPull).toHaveBeenCalledTimes(2);
  });

  it('still lists the PR, with an unknown state, when GitHub is not configured or fails', async () => {
    const off = setup({ runs: [run(1)], githubReady: false });
    const broken = setup({
      runs: [run(1)],
      getPull: jest.fn().mockRejectedValue(new Error('GitHub 502')),
    });

    expect((await off.service.list(7, NOW))[0].title).toContain(
      'статус неизвестен',
    );
    expect((await broken.service.list(7, NOW))[0].title).toContain(
      'статус неизвестен',
    );
  });

  it('keeps the other sources when one of them fails', async () => {
    const { service, questions } = setup({
      cards: [
        {
          openCount: 2,
          questions: [
            { resolved: false, createdAt: new Date('2026-10-29T00:00:00Z') },
            { resolved: false, createdAt: new Date('2026-10-30T00:00:00Z') },
          ],
        },
      ],
      runs: [run(1)],
    });
    questions.listCards.mockResolvedValueOnce(
      (await questions.listCards()) as never,
    );
    const failing = setup({ runs: [run(1)] });
    failing.questions.listCards.mockRejectedValue(new Error('db'));

    const items = await failing.service.list(7, NOW);

    expect(items.map((item) => item.kind)).toEqual([
      'pr_ready',
      'source_unavailable',
    ]);
    expect(items.at(-1)?.title).toBe('Не удалось проверить: вопросы');
    expect(
      (await service.list(7, NOW)).find((item) => item.kind === 'questions')
        ?.since,
    ).toBe('2026-10-29T00:00:00.000Z');
  });

  it('does not report a failed job that a later success of the same task recovered', async () => {
    const at = (h: number) => new Date(`2026-10-30T0${h}:00:00Z`);
    const { service } = setup({
      failed: [
        {
          id: 1,
          taskKey: 'a',
          model: 'sonnet',
          errorMessage: 'x',
          updatedAt: at(2),
        },
        {
          id: 2,
          taskKey: 'b',
          model: 'sonnet',
          errorMessage: 'y',
          updatedAt: at(3),
        },
      ],
      succeeded: [{ id: 9, taskKey: 'a', updatedAt: at(4) }],
    });

    const [item] = await service.list(7, NOW);

    expect(item.kind).toBe('jobs_failed');
    expect(item.title).toBe('Упавших запусков за сутки: 1');
    expect(item.detail).toContain('#2 b');
  });

  it('does not report a failed job while a later run of the same task is active, but does for an earlier one', async () => {
    const at = (h: number) => new Date(`2026-10-30T0${h}:00:00Z`);
    const failedJob = (id: number, taskKey: string) => ({
      id,
      taskKey,
      model: 'sonnet',
      errorMessage: 'x',
      createdAt: at(1),
      updatedAt: at(2),
    });
    const { service } = setup({
      failed: [failedJob(1, 'a'), failedJob(2, 'b'), failedJob(3, 'c')],
      active: [
        { id: 9, taskKey: 'a', createdAt: at(3) },
        { id: 8, taskKey: 'b', createdAt: new Date('2026-10-30T00:30:00Z') },
      ],
    });

    const [item] = await service.list(7, NOW);

    expect(item.title).toBe('Упавших запусков за сутки: 2');
    expect(item.detail).toContain('#2 b');
    expect(item.detail).toContain('#3 c');
    expect(item.detail).not.toContain('#1 a');
  });

  it('ignores a limit whose window already reset, and counts a live one', async () => {
    const future = Math.floor(NOW.getTime() / 1000) + 3600;
    const past = Math.floor(NOW.getTime() / 1000) - 3600;
    const base = { enabled: true, lastSeenAt: NOW, claudeCredentialId: null };
    const { service } = setup({
      workers: [
        {
          ...base,
          name: 'reset',
          claudeLimits: {
            status: 'rejected',
            windows: { five_hour: { utilization: 1, resetsAt: past } },
          },
        },
        {
          ...base,
          name: 'live',
          claudeLimits: {
            status: 'allowed',
            windows: { five_hour: { utilization: 0.9, resetsAt: future } },
          },
        },
      ],
    });

    const items = await service.list(7, NOW);

    expect(items.map((item) => item.id)).toEqual(['limit:live']);
  });
});
