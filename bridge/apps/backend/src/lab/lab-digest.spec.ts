import {
  autoDigestDue,
  buildDigestInput,
  cleanTags,
  clearPublicRepoCache,
  type DigestItem,
  digestPrompt,
  isPublicRepo,
  isWeekStart,
  lastFinishedWeek,
  parseDigestResult,
  previousWeekStart,
  recentWeeks,
  splitByVisibility,
  weekRange,
  weekStartOf,
} from './lab-digest';

const item = (over: Partial<DigestItem> = {}): DigestItem => ({
  source: 'lab',
  id: 1,
  title: 'Обновить зависимости',
  repo: 'bmazurme/pipe',
  status: 'pr_open',
  url: 'https://github.com/bmazurme/pipe/pull/5',
  finishedAt: '2026-11-10T09:30:00.000Z',
  jobId: 11,
  model: 'haiku',
  costUsd: 0.25,
  ...over,
});

// 2026-11-09 is a Monday.
describe('weeks (Moscow time, Monday to Sunday)', () => {
  it('finds the Monday of the week', () => {
    expect(weekStartOf(new Date('2026-11-11T10:00:00Z'))).toBe('2026-11-09');
    expect(weekStartOf(new Date('2026-11-09T00:30:00+03:00'))).toBe(
      '2026-11-09',
    );
  });

  it('goes by Moscow midnight, not UTC', () => {
    // Sunday 20:59 UTC is still Sunday 23:59 in Moscow; 21:00 UTC is already Monday.
    expect(weekStartOf(new Date('2026-11-15T20:59:00Z'))).toBe('2026-11-09');
    expect(weekStartOf(new Date('2026-11-15T21:00:00Z'))).toBe('2026-11-16');
  });

  it('accepts only real Mondays', () => {
    expect(isWeekStart('2026-11-09')).toBe(true);
    expect(isWeekStart('2026-11-10')).toBe(false);
    expect(isWeekStart('2026-02-30')).toBe(false);
    expect(isWeekStart('09.11.2026')).toBe(false);
  });

  it('gives the half-open range of a week', () => {
    const { from, to } = weekRange('2026-11-09');

    expect(from.toISOString()).toBe('2026-11-08T21:00:00.000Z');
    expect(to.toISOString()).toBe('2026-11-15T21:00:00.000Z');
  });

  it('knows the week before and the one that just ended', () => {
    expect(previousWeekStart('2026-11-09')).toBe('2026-11-02');
    expect(lastFinishedWeek(new Date('2026-11-11T10:00:00Z'))).toBe(
      '2026-11-02',
    );
  });

  it('lists recent weeks newest first', () => {
    expect(recentWeeks(new Date('2026-11-11T10:00:00Z'), 3)).toEqual([
      '2026-11-09',
      '2026-11-02',
      '2026-10-26',
    ]);
  });

  it('runs the automatic digest from Monday 06:00 Moscow time', () => {
    expect(autoDigestDue(new Date('2026-11-09T02:59:00Z'))).toBe(false);
    expect(autoDigestDue(new Date('2026-11-09T03:00:00Z'))).toBe(true);
    expect(autoDigestDue(new Date('2026-11-12T12:00:00Z'))).toBe(true);
  });
});

describe('isPublicRepo', () => {
  beforeEach(() => clearPublicRepoCache());

  const answer = (status: number) =>
    jest.fn().mockResolvedValue({ status }) as unknown as typeof fetch;

  it('is public on a 200, private on a 404', async () => {
    expect(await isPublicRepo('a/b', answer(200))).toBe(true);
    clearPublicRepoCache();
    expect(await isPublicRepo('a/b', answer(404))).toBe(false);
  });

  it('counts a failure or a rate limit as private', async () => {
    expect(
      await isPublicRepo(
        'a/b',
        jest
          .fn()
          .mockRejectedValue(new Error('down')) as unknown as typeof fetch,
      ),
    ).toBe(false);
    clearPublicRepoCache();
    expect(await isPublicRepo('a/b', answer(403))).toBe(false);
  });

  it('does not ask for an unknown or malformed repository', async () => {
    const fetchFn = answer(200);

    expect(await isPublicRepo(null, fetchFn)).toBe(false);
    expect(await isPublicRepo('../etc/passwd', fetchFn)).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('remembers the answer for an hour', async () => {
    const fetchFn = answer(200);
    let now = 1_000;

    await isPublicRepo('a/b', fetchFn, () => now);
    await isPublicRepo('a/b', fetchFn, () => now);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    now += 61 * 60 * 1000;
    await isPublicRepo('a/b', fetchFn, () => now);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe('splitByVisibility', () => {
  const items = [
    item({ id: 1, repo: 'a/pub' }),
    item({ id: 2, repo: 'a/priv' }),
    item({ id: 3, source: 'parcel', repo: null }),
    item({ id: 4, repo: 'a/pub' }),
  ];
  const isPublic = jest.fn(async (repo: string | null) => repo === 'a/pub');

  beforeEach(() => isPublic.mockClear());

  it('leaves private repositories and parcels out by default', async () => {
    const { included, excludedPrivate } = await splitByVisibility(
      items,
      false,
      isPublic,
    );

    expect(included.map((i) => i.id)).toEqual([1, 4]);
    expect(excludedPrivate).toBe(2);
  });

  it('asks about each repository once', async () => {
    await splitByVisibility(items, false, isPublic);

    expect(isPublic).toHaveBeenCalledTimes(3);
  });

  it('takes everything when private work is allowed, without asking GitHub', async () => {
    const { included, excludedPrivate } = await splitByVisibility(
      items,
      true,
      isPublic,
    );

    expect(included).toHaveLength(4);
    expect(excludedPrivate).toBe(0);
    expect(isPublic).not.toHaveBeenCalled();
  });
});

describe('buildDigestInput', () => {
  it('lists the week, the totals and each item with the end of its output', () => {
    const text = buildDigestInput(
      { weekStart: '2026-11-09' },
      [
        item(),
        item({ id: 2, title: 'Вторая', jobId: null, costUsd: null, url: null }),
      ],
      new Map([[11, 'Готово.\n\nPR открыт']]),
    );

    expect(text).toContain('# Неделя 2026-11-09 — 2026-11-15');
    expect(text).toContain('Завершённых работ: 2.');
    expect(text).toContain('0.25 USD');
    expect(text).toContain('## 1. Обновить зависимости');
    expect(text).toContain('- Репозиторий: bmazurme/pipe');
    expect(text).toContain('- Конец вывода модели: Готово. PR открыт');
    expect(text).toContain('## 2. Вторая');
    expect(text).not.toMatch(/\n\n\n/);
  });

  it('says how many items were left out of a long week', () => {
    const text = buildDigestInput(
      { weekStart: '2026-11-09' },
      [item()],
      new Map(),
      5,
    );

    expect(text).toContain(
      'Завершённых работ: 6 (ниже первые 1, остальные 5 опущены)',
    );
  });

  it('cuts a long output to its end', () => {
    const text = buildDigestInput(
      { weekStart: '2026-11-09' },
      [item()],
      new Map([[11, `${'x'.repeat(2000)}ХВОСТ`]]),
    );

    expect(text).toContain('…');
    expect(text).toContain('ХВОСТ');
    expect(text.length).toBeLessThan(1500);
  });
});

describe('digestPrompt', () => {
  it('asks for digest.json, in Russian, without secrets', () => {
    const prompt = digestPrompt({ weekStart: '2026-11-09' });

    expect(prompt).toContain('digest.json');
    expect(prompt).toContain('digest-input.md');
    expect(prompt).toContain('2026-11-09');
    expect(prompt).toMatch(/токены, пароли/);
  });
});

describe('parseDigestResult', () => {
  const good = {
    title: 'Неделя 9–15 ноября',
    preview: 'Обновили зависимости.',
    content: '## Итоги\n\nСделано три работы.',
    tags: ['Lab', ' #improve ', 'lab'],
  };

  it('reads a note and tidies the tags', () => {
    expect(parseDigestResult(JSON.stringify(good))).toEqual({
      ...good,
      tags: ['lab', 'improve'],
    });
  });

  it('reads bytes too', () => {
    expect(
      parseDigestResult(new TextEncoder().encode(JSON.stringify(good))).title,
    ).toBe(good.title);
  });

  it('cuts a long title and takes the preview from the text when it is missing', () => {
    const note = parseDigestResult(
      JSON.stringify({ ...good, title: 'я'.repeat(300), preview: undefined }),
    );

    expect(note.title).toHaveLength(100);
    expect(note.preview).toContain('Итоги');
  });

  it.each([
    ['not json', 'невалидный JSON'],
    ['[]', 'нет заголовка'],
    [JSON.stringify({ ...good, title: ' ' }), 'нет заголовка'],
    [JSON.stringify({ ...good, content: 'коротко' }), 'нет текста заметки'],
  ])('refuses %s', (raw, reason) => {
    expect(() => parseDigestResult(raw)).toThrow(reason);
  });
});

describe('cleanTags', () => {
  it('lowercases, drops hashes, spaces and duplicates, and keeps at most 8', () => {
    expect(cleanTags(['A b', '#c', 'c', 7, ''])).toEqual(['a-b', 'c']);
    expect(
      cleanTags(Array.from({ length: 20 }, (_, i) => `t${i}`)),
    ).toHaveLength(8);
    expect(cleanTags('nope')).toEqual([]);
  });
});
