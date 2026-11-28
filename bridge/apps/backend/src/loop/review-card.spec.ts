import {
  areaOf,
  buildReviewCard,
  formatReviewCard,
  verificationFromBody,
  type ReviewInput,
} from './review-card';

const file = (
  path: string,
  additions = 10,
  deletions = 2,
  status = 'modified',
) => ({
  path,
  additions,
  deletions,
  status,
});

const base = (over: Partial<ReviewInput> = {}): ReviewInput => ({
  number: 12,
  title: 'Add the thing',
  url: 'https://github.com/o/r/pull/12',
  base: 'main',
  body: null,
  mergeable: true,
  ci: 'success',
  files: [
    file('bridge/apps/backend/src/chat/a.ts', 80, 2),
    file('bridge/apps/backend/src/chat/a.spec.ts', 40, 0, 'added'),
    file('docs/components.md', 3, 1),
  ],
  protectedHits: [],
  runs: [],
  jobs: [],
  ...over,
});

const PASSED =
  '**Проверка перед PR:** пройдена (`node scripts/verify-changed.mjs` в песочнице worker, 24 с).\nНе проверено: e2e; миграции.';

describe('areaOf', () => {
  it.each([
    ['bridge/apps/backend/src/a.ts', 'bridge backend'],
    ['bridge/apps/frontend/src/a.tsx', 'bridge frontend'],
    ['bridge/apps/backend/src/a.spec.ts', 'тесты'],
    ['docs/x.md', 'документация'],
    ['reports/packages/server/src/a.ts', 'reports'],
    ['.github/workflows/ci.yml', 'CI и скрипты'],
    ['LICENSE', 'прочее'],
  ])('%s is %s', (path, area) => expect(areaOf(path)).toBe(area));
});

describe('verificationFromBody', () => {
  it('reads a passed check with what it did not cover', () => {
    expect(verificationFromBody(`text\n\n${PASSED}\n\nmore`)).toEqual({
      status: 'passed',
      summary: expect.stringContaining('пройдена'),
      notVerified: ['e2e', 'миграции'],
    });
  });

  it('tells a failed one and an unverified one apart, and knows when there is none', () => {
    expect(
      verificationFromBody('**Проверка перед PR:** НЕ пройдена — lint.')
        ?.status,
    ).toBe('failed');
    expect(
      verificationFromBody(
        '**Проверка перед PR:** не выполнена — нет окружения. Судья — CI.',
      )?.status,
    ).toBe('unverified');
    expect(verificationFromBody('just a description')).toBeNull();
    expect(verificationFromBody(null)).toBeNull();
  });

  it('reads the line with the automatic-fix note too', () => {
    expect(
      verificationFromBody(
        '**Проверка перед PR (после одного автоматического исправления):** пройдена (x).',
      )?.status,
    ).toBe('passed');
  });
});

describe('buildReviewCard', () => {
  it('summarises the diff: counts, areas, the biggest files', () => {
    const card = buildReviewCard(base());

    expect(card.diff).toEqual({
      files: 3,
      additions: 123,
      deletions: 3,
      areas: [
        { name: 'bridge backend', files: 1 },
        { name: 'тесты', files: 1 },
        { name: 'документация', files: 1 },
      ],
      largest: [
        {
          path: 'bridge/apps/backend/src/chat/a.ts',
          additions: 80,
          deletions: 2,
        },
        {
          path: 'bridge/apps/backend/src/chat/a.spec.ts',
          additions: 40,
          deletions: 0,
        },
        { path: 'docs/components.md', additions: 3, deletions: 1 },
      ],
    });
  });

  it('carries the risk from S3 with its reasons', () => {
    expect(buildReviewCard(base()).risk.level).toBe('medium');
    expect(buildReviewCard(base({ files: [file('docs/a.md')] })).risk).toEqual({
      level: 'low',
      text: 'Риск: низкий (документация)',
    });
    expect(
      buildReviewCard(base({ files: [file('infra/x.sh')] })).risk.level,
    ).toBe('high');
  });

  it('points at what is worth a look, from the files only', () => {
    const card = buildReviewCard(
      base({
        files: [
          file('bridge/apps/backend/src/a.ts', 500, 400),
          file('bridge/apps/backend/src/migrations/1-x.ts'),
          file('bridge/package.json'),
          file('bridge/apps/backend/src/old.ts', 0, 30, 'removed'),
        ],
      }),
    );

    expect(card.attention).toEqual([
      'Код изменён, а тестов среди файлов нет',
      'Есть миграция БД',
      'Менялись зависимости',
      'Удалено файлов: 1',
      'Большое изменение: 954 строк',
    ]);
    expect(buildReviewCard(base()).attention).toEqual([]);
  });

  it('says what was checked and, as plainly, what was not', () => {
    const card = buildReviewCard(base({ body: PASSED }));

    expect(card.checked).toEqual([
      'CI зелёный',
      'защищённые пути не затронуты',
      'конфликтов с основной веткой нет',
      'проверка воркера перед PR пройдена',
    ]);
    expect(card.notChecked).toEqual([
      'Diff человеком не читался — это и есть ваше ревью',
      'Воркер не проверял: e2e',
      'Воркер не проверял: миграции',
    ]);
  });

  it('puts a red or unknown state on the not-checked side', () => {
    const card = buildReviewCard(
      base({
        ci: 'pending',
        mergeable: null,
        protectedHits: ['infra/a.sh'],
        body: '**Проверка перед PR:** НЕ пройдена — lint.',
      }),
    );

    expect(card.checked).toEqual([]);
    expect(card.notChecked).toEqual(
      expect.arrayContaining([
        'CI: ещё идёт',
        'Затронуты защищённые пути (infra/a.sh) — только ручной merge',
        'Конфликты ещё считаются',
        'Проверка воркера перед PR не пройдена',
      ]),
    );
  });

  it('adds up what the runs behind the pull request cost and how long they worked', () => {
    const card = buildReviewCard(
      base({
        runs: [
          {
            id: 1,
            kind: 'issue',
            trigger: 'auto',
            model: 'haiku',
            tier: 2,
            jobId: 10,
            escalated: false,
          },
          {
            id: 2,
            kind: 'repair',
            trigger: 'ci',
            model: 'haiku',
            tier: 2,
            jobId: 11,
            escalated: false,
          },
        ],
        jobs: [
          { id: 10, costUsd: 0.2, seconds: 360 },
          { id: 11, costUsd: 0.1, seconds: 100 },
          { id: 99, costUsd: 5, seconds: 9999 },
        ],
      }),
    );

    expect(card.run).toEqual({
      model: 'haiku',
      tier: 2,
      trigger: 'auto',
      attempts: 2,
      ciRepairs: 1,
      escalated: false,
      workMinutes: 8,
      costUsd: expect.closeTo(0.3, 5),
    });
  });

  it('has no run for a pull request nobody started here, and no figure it does not know', () => {
    expect(buildReviewCard(base()).run).toBeNull();

    const unknown = buildReviewCard(
      base({
        runs: [
          {
            id: 1,
            kind: 'issue',
            trigger: 'manual',
            model: 'opus',
            tier: null,
            jobId: 10,
            escalated: true,
          },
        ],
        jobs: [{ id: 10, costUsd: null, seconds: null }],
      }),
    ).run;

    expect(unknown).toMatchObject({
      workMinutes: null,
      costUsd: null,
      escalated: true,
    });
  });
});

describe('formatReviewCard', () => {
  it('lays the card out as the Telegram message, ending with the question', () => {
    const text = formatReviewCard(
      buildReviewCard(
        base({
          body: PASSED,
          runs: [
            {
              id: 1,
              kind: 'issue',
              trigger: 'auto',
              model: 'sonnet',
              tier: 3,
              jobId: 10,
              escalated: false,
            },
          ],
          jobs: [{ id: 10, costUsd: 1.4, seconds: 420 }],
        }),
      ),
      {
        improveUrl: 'https://bridge.example/improve',
        question: 'Влить в main (squash)?',
      },
    );

    expect(text).toBe(
      [
        '🟢 CI зелёный: PR #12 «Add the thing»',
        '🟡 Риск: средний (код)',
        'Изменено: 3 файла, +123 −3 — bridge backend 1, тесты 1, документация 1',
        'Крупнее всего: bridge/apps/backend/src/chat/a.ts (+80 −2), bridge/apps/backend/src/chat/a.spec.ts (+40 −0), docs/components.md (+3 −1)',
        'Проверено: CI зелёный, защищённые пути не затронуты, конфликтов с основной веткой нет, проверка воркера перед PR пройдена',
        'Не проверено: Diff человеком не читался — это и есть ваше ревью; Воркер не проверял: e2e; Воркер не проверял: миграции',
        'Запуск: sonnet, ярус 3 · 7 мин · $1.40 · запуск: auto',
        'Метрики: https://bridge.example/improve',
        '',
        'Влить в main (squash)?',
      ].join('\n'),
    );
  });

  it('shows the warnings, and leaves the run line out when there is no run', () => {
    const text = formatReviewCard(
      buildReviewCard(
        base({ files: [file('bridge/apps/backend/src/a.ts', 5, 0)] }),
      ),
      { question: 'Влить?' },
    );

    expect(text).toContain(
      '⚠️ Обратите внимание: Код изменён, а тестов среди файлов нет',
    );
    expect(text).not.toContain('Запуск:');
    expect(text).not.toContain('Метрики:');
    expect(text).toContain('Изменено: 1 файл,');
  });
});
