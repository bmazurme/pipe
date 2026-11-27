import {
  figures,
  needsRefresh,
  type OutcomeRow,
  revertedPrNumbers,
  summarizeQuality,
} from './quality';

const NOW = new Date('2026-11-27T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const row = (over: Partial<OutcomeRow> = {}): OutcomeRow => ({
  prNumber: 1,
  model: 'haiku',
  tier: 2,
  state: 'merged',
  firstCi: 'success',
  ciRepairs: 0,
  costUsd: 0.5,
  openedAt: hoursAgo(10),
  mergedAt: hoursAgo(9),
  reverted: false,
  ...over,
});

describe('revertedPrNumbers', () => {
  it('reads the number out of a revert title and ignores other pull requests', () => {
    const titles = [
      { number: 5, title: 'Revert "tasks: drag fix (#1298)"' },
      { number: 6, title: 'revert: the dialog change (#1200) and #1201' },
      { number: 7, title: 'worker: do not revert (#1)' },
      { number: 8, title: 'Reverting is hard (#2)' },
    ];

    expect([...revertedPrNumbers(titles)].sort()).toEqual([1200, 1201, 1298]);
  });
});

describe('needsRefresh', () => {
  it('keeps an open pull request in view and drops a closed one', () => {
    expect(
      needsRefresh({ state: 'open', mergedAt: null, firstCi: null }, NOW),
    ).toBe(true);
    expect(
      needsRefresh(
        { state: 'closed', mergedAt: null, firstCi: 'failure' },
        NOW,
      ),
    ).toBe(false);
  });

  it('watches a merged one for a week (a revert can still come), then lets it go', () => {
    expect(
      needsRefresh(
        { state: 'merged', mergedAt: hoursAgo(24), firstCi: 'success' },
        NOW,
      ),
    ).toBe(true);
    expect(
      needsRefresh(
        { state: 'merged', mergedAt: hoursAgo(24 * 8), firstCi: 'success' },
        NOW,
      ),
    ).toBe(false);
  });

  it('keeps asking while the first CI result is unknown, however old', () => {
    expect(
      needsRefresh(
        { state: 'merged', mergedAt: hoursAgo(24 * 30), firstCi: null },
        NOW,
      ),
    ).toBe(true);
  });
});

describe('figures', () => {
  it('is all empty for nothing, not zero', () => {
    expect(figures([])).toEqual({
      opened: 0,
      merged: 0,
      closed: 0,
      open: 0,
      firstGreenRate: null,
      repairsPerMerged: null,
      medianHoursToMerge: null,
      costPerMergedUsd: null,
      withoutCost: 0,
      revertRate: null,
    });
  });

  it('counts states and the first-attempt CI over the pull requests whose CI has finished', () => {
    const f = figures([
      row({ prNumber: 1, firstCi: 'success' }),
      row({ prNumber: 2, firstCi: 'failure', ciRepairs: 1 }),
      row({ prNumber: 3, firstCi: null, state: 'open', mergedAt: null }),
      row({ prNumber: 4, firstCi: 'failure', state: 'closed', mergedAt: null }),
    ]);

    expect(f).toMatchObject({ opened: 4, merged: 2, closed: 1, open: 1 });
    // 1 green of 3 decided; the open one with no CI result yet is not a failure.
    expect(f.firstGreenRate).toBeCloseTo(0.333, 3);
    expect(f.repairsPerMerged).toBe(0.5);
  });

  it('takes the median hours to merge', () => {
    const f = figures([
      row({ prNumber: 1, openedAt: hoursAgo(10), mergedAt: hoursAgo(9) }),
      row({ prNumber: 2, openedAt: hoursAgo(10), mergedAt: hoursAgo(8) }),
      row({ prNumber: 3, openedAt: hoursAgo(10), mergedAt: hoursAgo(2) }),
    ]);

    expect(f.medianHoursToMerge).toBe(2);
  });

  it('divides everything spent by what was merged, so a closed pull request is a cost with nothing to show', () => {
    const f = figures([
      row({ prNumber: 1, costUsd: 1 }),
      row({ prNumber: 2, state: 'closed', mergedAt: null, costUsd: 3 }),
      row({ prNumber: 3, costUsd: null }),
    ]);

    expect(f.costPerMergedUsd).toBe(2);
    expect(f.withoutCost).toBe(1);
  });

  it('has no cost per merge when nothing reported a cost, or nothing was merged', () => {
    expect(figures([row({ costUsd: null })]).costPerMergedUsd).toBeNull();
    expect(
      figures([row({ state: 'closed', mergedAt: null })]).costPerMergedUsd,
    ).toBeNull();
  });

  it('counts reverts against the merged ones', () => {
    const f = figures([
      row({ prNumber: 1, reverted: true }),
      row({ prNumber: 2 }),
      row({ prNumber: 3 }),
      row({ prNumber: 4 }),
    ]);

    expect(f.revertRate).toBe(0.25);
  });
});

describe('summarizeQuality', () => {
  it('looks only at the period, and splits by model and tier, a fixed-model run last', () => {
    const view = summarizeQuality(
      [
        row({ prNumber: 1, model: 'haiku', tier: 1 }),
        row({ prNumber: 2, model: 'sonnet', tier: 3, firstCi: 'failure' }),
        row({ prNumber: 3, model: 'haiku', tier: null }),
        row({
          prNumber: 4,
          model: 'opus',
          openedAt: hoursAgo(24 * 40),
          mergedAt: hoursAgo(24 * 40 - 1),
        }),
      ],
      30,
      NOW,
    );

    expect(view.total.opened).toBe(3);
    expect(view.byModel.map((g) => g.key)).toEqual(['haiku', 'sonnet']);
    expect(view.byModel.find((g) => g.key === 'sonnet')?.firstGreenRate).toBe(
      0,
    );
    expect(view.byTier.map((g) => g.key)).toEqual(['1', '3', 'none']);
  });
});
