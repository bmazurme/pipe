import { buildInbox, InboxFacts } from './inbox';

const NOW = new Date('2026-10-30T12:00:00Z');
const empty: InboxFacts = {
  loopPause: null,
  pulls: [],
  openQuestions: 0,
  openQuestionCards: 0,
  oldestQuestionAt: null,
  boards: [],
  workers: [],
  failedJobs: [],
  now: NOW,
};
const build = (over: Partial<InboxFacts>) => buildInbox({ ...empty, ...over });

describe('buildInbox', () => {
  it('is empty when nothing needs a decision', () => {
    expect(build({})).toEqual([]);
  });

  it('puts a green PR first, a red one lower, a running one last', () => {
    const items = build({
      pulls: [
        { number: 3, title: 'c', url: null, ci: 'pending', openedAt: null },
        { number: 2, title: 'b', url: 'u', ci: 'failure', openedAt: null },
        { number: 1, title: 'a', url: 'u', ci: 'success', openedAt: null },
      ],
    });

    expect(items.map((item) => [item.id, item.kind, item.severity])).toEqual([
      ['pr:1', 'pr_ready', 'high'],
      ['pr:2', 'pr_failing', 'medium'],
      ['pr:3', 'pr_waiting', 'low'],
    ]);
    expect(items[0].externalUrl).toBe('u');
  });

  it('summarises open questions with the oldest time and the right plural', () => {
    const [one] = build({
      openQuestions: 3,
      openQuestionCards: 1,
      oldestQuestionAt: '2026-10-29T00:00:00Z',
    });

    expect(one).toMatchObject({
      kind: 'questions',
      link: '/questions',
      since: '2026-10-29T00:00:00Z',
    });
    expect(one.title).toBe('Открытых вопросов: 3');
    expect(one.detail).toContain('в 1 задаче');
  });

  it('flags an offline board high, a warning medium, and offers an update only to an online board', () => {
    const items = build({
      boards: [
        {
          host: 'red',
          online: false,
          reportedAt: '2026-10-29T00:00:00Z',
          outdated: 2,
          updatable: 2,
          warnings: [],
        },
        {
          host: 'green',
          online: true,
          reportedAt: '2026-10-30T11:00:00Z',
          outdated: 1,
          updatable: 1,
          warnings: ['Диск заполнен на 91 %', 'SSH принимает пароли'],
        },
      ],
    });

    expect(items.map((item) => [item.id, item.severity])).toEqual([
      ['board-offline:red', 'high'],
      ['board-warning:green', 'medium'],
      ['board-outdated:green', 'low'],
    ]);
    expect(items[1].detail).toBe('SSH принимает пароли');
  });

  it('reports a quiet worker only when it is enabled, and a limit by how full it is', () => {
    const worker = {
      enabled: true,
      online: true,
      lastSeenAt: null,
      limitStatus: null as string | null,
    };
    const items = build({
      workers: [
        { ...worker, name: 'quiet', online: false, limitUtilization: null },
        {
          ...worker,
          name: 'paused',
          enabled: false,
          online: false,
          limitUtilization: null,
        },
        { ...worker, name: 'warm', limitUtilization: 0.85 },
        { ...worker, name: 'full', limitUtilization: 0.97 },
        {
          ...worker,
          name: 'rejected',
          limitUtilization: 0.2,
          limitStatus: 'rejected',
        },
        { ...worker, name: 'fine', limitUtilization: 0.3 },
      ],
    });

    expect(items.map((item) => [item.id, item.severity])).toEqual([
      ['limit:full', 'high'],
      ['limit:rejected', 'high'],
      ['worker-offline:quiet', 'medium'],
      ['limit:warm', 'medium'],
    ]);
    expect(items.find((item) => item.id === 'limit:warm')?.title).toContain(
      '85 %',
    );
  });

  it('groups failed jobs into one item, high from three, listing at most five', () => {
    const job = (id: number) => ({
      id,
      taskKey: `9001:${id}`,
      model: 'sonnet',
      error: 'claude timed out after 1800s and was killed',
      at: `2026-10-30T0${id}:00:00Z`,
    });
    const [two] = build({ failedJobs: [job(1), job(2)] });
    const [many] = build({ failedJobs: [1, 2, 3, 4, 5, 6, 7].map(job) });

    expect(two.severity).toBe('medium');
    expect(many.severity).toBe('high');
    expect(many.title).toBe('Упавших запусков за сутки: 7');
    expect(many.detail?.split('\n')).toHaveLength(5);
    expect(many.detail).toContain('#1 9001:1 — claude timed out');
  });

  it('orders by urgency, then by how long it has waited', () => {
    const items = build({
      openQuestions: 1,
      openQuestionCards: 1,
      oldestQuestionAt: '2026-10-28T00:00:00Z',
      boards: [
        {
          host: 'old',
          online: false,
          reportedAt: '2026-10-27T00:00:00Z',
          outdated: 0,
          updatable: 0,
          warnings: [],
        },
        {
          host: 'new',
          online: false,
          reportedAt: '2026-10-29T00:00:00Z',
          outdated: 0,
          updatable: 0,
          warnings: [],
        },
      ],
    });

    expect(items.map((item) => item.id)).toEqual([
      'board-offline:old',
      'board-offline:new',
      'questions',
    ]);
  });

  it('puts the paused automation first, with the reason and who stopped it', () => {
    const items = build({
      loopPause: {
        reason: 'версия 9781a0d не прошла проверку',
        by: 'deploy',
        since: '2026-10-30T08:00:00Z',
      },
      openQuestions: 1,
      openQuestionCards: 1,
    });

    expect(items[0]).toMatchObject({
      id: 'loop-paused',
      kind: 'loop_paused',
      severity: 'high',
      link: '/improve',
      since: '2026-10-30T08:00:00Z',
    });
    expect(items[0].detail).toBe(
      'версия 9781a0d не прошла проверку — остановил откат релиза',
    );
  });
});
