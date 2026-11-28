import {
  adviseTier,
  buildCells,
  buildModelCards,
  CHEAPER_RATIO,
  MIN_SAMPLES,
} from './model-cards';
import type { OutcomeRow } from './quality';

const NOW = new Date('2026-12-10T12:00:00Z');
let next = 1;

function row(over: Partial<OutcomeRow> = {}): OutcomeRow {
  return {
    prNumber: next++,
    model: 'haiku',
    tier: 2,
    state: 'merged',
    firstCi: 'success',
    ciRepairs: 0,
    costUsd: 0.2,
    openedAt: new Date('2026-12-01T00:00:00Z'),
    mergedAt: new Date('2026-12-02T00:00:00Z'),
    reverted: false,
    escalatedFrom: null,
    workSeconds: 600,
    ...over,
  };
}

const many = (n: number, over: Partial<OutcomeRow> = {}) =>
  Array.from({ length: n }, () => row(over));

describe('buildCells', () => {
  it('makes one card per model × tier, from the pull requests started on that model', () => {
    const cells = buildCells([
      ...many(6),
      ...many(2, { model: 'sonnet', costUsd: 1 }),
      ...many(1, { tier: 3 }),
    ]);

    expect(cells.map((c) => [c.model, c.tier, c.prs])).toEqual(
      [
        ['haiku', 2, 6],
        ['sonnet', 2, 2],
        ['haiku', 3, 1],
      ].sort(
        (a, b) =>
          (a[1] as number) - (b[1] as number) ||
          String(a[0]).localeCompare(String(b[0])),
      ),
    );
  });

  it('leaves out a pull request that was not routed (no tier)', () => {
    expect(buildCells(many(3, { tier: null }))).toEqual([]);
  });

  it('computes the figures of a card: close rate, first CI, repairs, work minutes, cost per merged', () => {
    const [cell] = buildCells([
      ...many(4, { ciRepairs: 1, workSeconds: 300 }),
      row({
        state: 'closed',
        mergedAt: null,
        firstCi: 'failure',
        costUsd: 0.4,
      }),
    ]);

    expect(cell).toMatchObject({
      model: 'haiku',
      tier: 2,
      prs: 5,
      merged: 4,
      closed: 1,
      stepUps: 0,
      samples: 5,
      closeRate: 0.8,
      repairsPerMerged: 1,
      medianWorkMinutes: 5,
      costPerMergedUsd: 0.3,
      verdict: 'solid',
    });
    expect(cell.firstGreenRate).toBe(0.8);
  });

  it('counts a step up as the weaker model not being enough, not as a success of the stronger one', () => {
    const cells = buildCells([
      ...many(3),
      ...many(3, { model: 'sonnet', escalatedFrom: 'haiku', costUsd: 1 }),
    ]);
    const haiku = cells.find((c) => c.model === 'haiku');
    const sonnet = cells.find((c) => c.model === 'sonnet');

    expect(haiku).toMatchObject({
      prs: 3,
      merged: 3,
      stepUps: 3,
      samples: 6,
      closeRate: 0.5,
    });
    // starting on haiku cost the cheap ones and the step-ups, over all six that ended merged
    expect(haiku?.costPerMergedUsd).toBe(0.6);
    // the step-ups are nobody's direct pull requests on sonnet
    expect(sonnet).toBeUndefined();
  });

  it('gives a model that only ever handed work up a card of its own', () => {
    const cells = buildCells(
      many(2, { model: 'sonnet', escalatedFrom: 'haiku' }),
    );

    expect(cells).toEqual([
      expect.objectContaining({
        model: 'haiku',
        prs: 0,
        stepUps: 2,
        closeRate: 0,
        verdict: 'thin',
      }),
    ]);
  });

  it('is thin below the sample floor, weak when it does not close enough, weak when it keeps being reverted', () => {
    expect(buildCells(many(MIN_SAMPLES - 1))[0].verdict).toBe('thin');
    expect(
      buildCells([
        ...many(3),
        ...many(3, { state: 'closed', mergedAt: null }),
      ])[0].verdict,
    ).toBe('weak');
    expect(
      buildCells([
        ...many(4),
        row({ reverted: true }),
        row({ reverted: true }),
      ])[0].verdict,
    ).toBe('weak');
    expect(
      buildCells(many(MIN_SAMPLES, { firstCi: 'failure' }))[0].verdict,
    ).toBe('weak');
  });

  it('knows no work time for older outcomes', () => {
    expect(
      buildCells(many(5, { workSeconds: null }))[0].medianWorkMinutes,
    ).toBeNull();
  });
});

const cellsOf = (...groups: OutcomeRow[][]) => buildCells(groups.flat());

describe('adviseTier', () => {
  it('has nothing to say about a tier with no finished task', () => {
    expect(adviseTier(4, 'opus', [])).toMatchObject({ status: 'no-data' });
  });

  it('collects more data when the current model is thin, even if another one is already solid', () => {
    const cells = cellsOf(many(2), many(6, { model: 'sonnet', costUsd: 1 }));
    const advice = adviseTier(2, 'haiku', cells);

    expect(advice.status).toBe('collect');
    expect(advice.suggested).toBeUndefined();
    expect(advice.reason).toMatch(/2 из 5/);
    expect(advice.reason).toMatch(/«sonnet» уже закрывает 100 %/);
  });

  it('keeps a solid model that has nothing clearly cheaper', () => {
    const cells = cellsOf(many(6), many(6, { model: 'sonnet', costUsd: 1 }));

    expect(adviseTier(2, 'haiku', cells)).toMatchObject({ status: 'keep' });
  });

  it('suggests a clearly cheaper model that is just as solid, but not one that is only a little cheaper', () => {
    const dear = cellsOf(
      many(6, { model: 'sonnet', costUsd: 1 }),
      many(6, { model: 'haiku', costUsd: 0.3 }),
    );
    const advice = adviseTier(2, 'sonnet', dear);

    expect(advice).toMatchObject({ status: 'switch', suggested: 'haiku' });
    expect(advice.reason).toMatch(/дешевле/);

    const close = cellsOf(
      many(6, { model: 'sonnet', costUsd: 1 }),
      many(6, { model: 'haiku', costUsd: 1 * (CHEAPER_RATIO + 0.05) }),
    );

    expect(adviseTier(2, 'sonnet', close).status).toBe('keep');
  });

  it('suggests the cheapest solid model when the current one does not close enough', () => {
    const cells = cellsOf(
      [...many(3), ...many(3, { state: 'closed', mergedAt: null })],
      many(6, { model: 'sonnet', costUsd: 1 }),
      many(6, { model: 'opus', costUsd: 5 }),
    );
    const advice = adviseTier(2, 'haiku', cells);

    expect(advice).toMatchObject({ status: 'switch', suggested: 'sonnet' });
    expect(advice.reason).toMatch(/«haiku» закрыл сам 50 % из 6/);
  });

  it('collects when the current model is weak and nothing else is proven', () => {
    const cells = cellsOf([
      ...many(3),
      ...many(3, { state: 'closed', mergedAt: null }),
    ]);

    expect(adviseTier(2, 'haiku', cells)).toMatchObject({ status: 'collect' });
  });

  it('only advises about a model the router actually uses', () => {
    const cells = cellsOf(many(6), many(6, { model: 'sonnet', costUsd: 5 }));

    expect(adviseTier(2, 'haiku', cells).suggested).toBeUndefined();
  });
});

describe('buildModelCards', () => {
  it('limits to the period and advises each tier of the router table in order', () => {
    const old = many(8, { openedAt: new Date('2025-01-01T00:00:00Z') });
    const cards = buildModelCards(
      [...old, ...many(6)],
      { 1: 'haiku', 2: 'haiku', 3: 'haiku', 4: 'opus' },
      90,
      NOW,
    );

    expect(cards.cells.map((c) => c.prs)).toEqual([6]);
    expect(cards.advice.map((a) => [a.tier, a.status])).toEqual([
      [1, 'no-data'],
      [2, 'keep'],
      [3, 'no-data'],
      [4, 'no-data'],
    ]);
    expect(cards.rules.minSamples).toBe(MIN_SAMPLES);
  });
});
