import {
  detectIntent,
  groupAlerts,
  MAX_FACTS_CHARS,
  renderBroken,
  renderExplain,
  type RunDetail,
  type SystemSnapshot,
} from './system-facts';

describe('detectIntent', () => {
  it.each([
    'что сломалось?',
    'Что сейчас сломалось в системе',
    'что не так с bridge',
    'что с системой',
    'как дела у системы?',
    'есть ли проблемы?',
    'какие сейчас тревоги',
    "what's broken",
    'is anything broken right now',
    'system status please',
    'статус системы',
  ])('takes «%s» for a question about what is wrong', (text) => {
    expect(detectIntent(text)).toEqual({ kind: 'broken' });
  });

  it.each([
    ['объясни запуск #123', 123],
    ['почему упал запуск 45', 45],
    ['что случилось с run 7?', 7],
    ['explain job 9', 9],
    ['why did #88 fail', 88],
    ['разбери задачу #12', 12],
  ])('takes «%s» for a request to explain №%d', (text, id) => {
    expect(detectIntent(text)).toEqual({ kind: 'explain', id });
  });

  it('a specific run beats the general question in the same message', () => {
    expect(detectIntent('что сломалось? объясни запуск 5')).toEqual({
      kind: 'explain',
      id: 5,
    });
  });

  it.each([
    'привет',
    'напиши функцию сортировки',
    'сколько будет 2+2',
    'запуск 5',
    'почему небо голубое',
    'что значит этот код',
    'the build is broken in my own project — fix the lint',
  ])('leaves «%s» alone', (text) => {
    expect(detectIntent(text)).toBeNull();
  });

  it('needs a number to explain a run, and a verb to ask for one', () => {
    expect(detectIntent('объясни запуск')).toBeNull();
    expect(detectIntent('мой запуск 5 прошёл')).toBeNull();
  });
});

describe('groupAlerts', () => {
  const at = (minutes: number) =>
    new Date(Date.UTC(2026, 10, 27, 12, 0) - minutes * 60_000);
  const row = (event: string, level = 'warn', message = 'm', minutes = 0) => ({
    event,
    level,
    message,
    createdAt: at(minutes),
  });

  it('groups by event, the most frequent first, errors before warnings', () => {
    const groups = groupAlerts([
      row('telegram.api_failed', 'warn', 'a', 1),
      row('telegram.api_failed', 'warn', 'b', 5),
      row('job.failed', 'error', 'boom', 2),
      row('x', 'warn'),
    ]);

    expect(groups.map((g) => [g.event, g.count])).toEqual([
      ['job.failed', 1],
      ['telegram.api_failed', 2],
      ['x', 1],
    ]);
    // the rows come newest first, so the first of a group is its latest
    expect(groups[1].last).toBe('a');
  });

  it('leaves out what is the system working as meant', () => {
    expect(
      groupAlerts([row('http.slow'), row('job.succeeded', 'info')]),
    ).toEqual([]);
  });

  it('keeps one line of a long message', () => {
    const [group] = groupAlerts([
      row('e', 'error', `first line\n${'x'.repeat(500)}`),
    ]);

    expect(group.last).not.toContain('\n');
    expect(group.last.length).toBeLessThanOrEqual(160);
  });
});

const NOW = new Date('2026-11-27T12:00:00Z');

const snapshot = (over: Partial<SystemSnapshot> = {}): SystemSnapshot => ({
  now: NOW,
  health: { database: true, pendingMigrations: false },
  alerts: [],
  failedRuns: [],
  failedJobs: [],
  awaitingAnswers: 0,
  drift: { status: 'ok', items: [] },
  workers: { online: ['red', 'blue'], offline: [] },
  ...over,
});

describe('renderBroken', () => {
  it('says plainly that nothing is failing', () => {
    const text = renderBroken(snapshot());

    expect(text).toContain('Nothing is failing');
    expect(text).toContain('Online: red, blue.');
    expect(text).toContain('do not invent');
  });

  it('tells a database that cannot be reached, and migrations that did not run', () => {
    expect(
      renderBroken(
        snapshot({ health: { database: false, pendingMigrations: true } }),
      ),
    ).toContain('cannot reach its database');
    expect(
      renderBroken(
        snapshot({ health: { database: true, pendingMigrations: true } }),
      ),
    ).toContain('migrations that did not run');
  });

  it('lists drift, failed runs and jobs, alerts and who is offline', () => {
    const text = renderBroken(
      snapshot({
        drift: {
          status: 'bad',
          items: [
            {
              id: 'a',
              level: 'bad',
              subject: 'ubuntu-red',
              text: 'container restarted 12 times',
            },
          ],
        },
        failedRuns: [
          {
            id: 7,
            kind: 'issue',
            issueNumber: 42,
            title: 't',
            model: 'haiku',
            error: 'claude exited with code 1',
            finishedAt: NOW,
            prNumber: null,
          },
        ],
        failedJobs: [
          {
            id: 91,
            model: 'sonnet',
            error: 'timed out',
            finishedAt: NOW,
            taskKey: 'improve:42',
          },
        ],
        alerts: [
          {
            event: 'telegram.api_failed',
            level: 'warn',
            count: 3,
            last: 'ETIMEDOUT',
            lastAt: NOW,
          },
        ],
        awaitingAnswers: 2,
        workers: { online: ['red'], offline: ['green'] },
      }),
    );

    expect(text).toContain('🔴 ubuntu-red: container restarted 12 times');
    expect(text).toContain('Improve run #7 (issue, issue #42, haiku) failed');
    expect(text).toContain('claude exited with code 1');
    expect(text).toContain('Worker job #91 (sonnet, improve:42) failed');
    expect(text).toContain('warn telegram.api_failed ×3');
    expect(text).toContain('2 run(s) are waiting');
    expect(text).toContain('Not seen recently: green');
    expect(text).not.toContain('Nothing is failing');
  });

  it('does not claim everything is fine while every worker is silent', () => {
    expect(
      renderBroken(snapshot({ workers: { online: [], offline: ['red'] } })),
    ).not.toContain('Nothing is failing');
  });

  it('is bounded', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      kind: 'issue',
      issueNumber: i,
      title: 't',
      model: 'haiku',
      error: 'e'.repeat(400),
      finishedAt: NOW,
      prNumber: null,
    }));

    expect(
      renderBroken(snapshot({ failedRuns: many })).length,
    ).toBeLessThanOrEqual(MAX_FACTS_CHARS);
  });
});

describe('renderExplain', () => {
  const job = {
    id: 5,
    status: 'failed',
    model: 'haiku',
    error: 'claude exited with code 1',
    logs: 'Claimed job 5\nI tried to fix the lint\nTests still fail: 3 failing',
    createdAt: new Date('2026-11-27T10:00:00Z'),
    startedAt: new Date('2026-11-27T10:01:00Z'),
    finishedAt: new Date('2026-11-27T10:06:00Z'),
    costUsd: 0.42,
  };
  const run: NonNullable<RunDetail['run']> = {
    id: 5,
    kind: 'issue',
    status: 'failed',
    trigger: 'manual',
    model: 'haiku',
    issueNumber: 12,
    title: 'Fix the lint',
    prNumber: null,
    prUrl: null,
    branch: null,
    note: null,
    error: 'claude exited with code 1',
    gateRetries: 1,
    escalatedFromRunId: null,
    createdAt: new Date('2026-11-27T10:00:00Z'),
    finishedAt: new Date('2026-11-27T10:06:00Z'),
    jobId: 5,
  };

  it('says it does not exist, without inventing', () => {
    const text = renderExplain(999, {
      run: null,
      job: null,
      linkedJobId: null,
    });

    expect(text).toContain(
      'Neither an Improve run nor a Worker job with the number 999',
    );
    expect(text).toContain('do not guess');
  });

  it('explains a run with its job: what, how long, how much, the end of the log', () => {
    const text = renderExplain(5, { run, job, linkedJobId: 5 });

    expect(text).toContain('Improve run #5 — failed');
    expect(text).toContain('issue #12 «Fix the lint»');
    expect(text).toContain('sent back to fix it 1 time(s)');
    expect(text).toContain('Worker job #5 — failed');
    expect(text).toContain('ran 300 s');
    expect(text).toContain('$0.42');
    expect(text).toContain('Tests still fail: 3 failing');
    // the worker's own bookkeeping is not shown
    expect(text).not.toContain('Claimed job 5');
  });

  it('explains a job that belongs to no run', () => {
    const text = renderExplain(5, { run: null, job, linkedJobId: null });

    expect(text).toContain('Worker job #5');
    expect(text).not.toContain('Improve run');
  });

  it('says when a run is the step up after another', () => {
    expect(
      renderExplain(6, {
        run: { ...run, id: 6, escalatedFromRunId: 5 },
        job: null,
        linkedJobId: null,
      }),
    ).toContain('stronger model after run #5');
  });

  it('mentions a job that could not be read', () => {
    expect(renderExplain(5, { run, job: null, linkedJobId: 5 })).toContain(
      'job #5 of this run is gone',
    );
  });
});
