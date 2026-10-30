import {
  countOpenByCategory,
  DEFAULT_LIMITS,
  planFiling,
} from './improve-throttle';

const item = (
  category: string,
  value: number,
  effort: 's' | 'm' | 'l' = 'm',
) => ({ category: category as never, value, effort });
const empty = { openByCategory: {}, filedLast24h: 0 };

describe('planFiling', () => {
  it('files the best value per effort first, and keeps the model order between equals', () => {
    const plan = planFiling(
      [
        item('ui', 3, 'l'),
        item('tests', 4, 's'),
        item('docs', 3, 'm'),
        item('perf', 3, 'm'),
      ],
      empty,
      { ...DEFAULT_LIMITS, dailyIssueCap: 10 },
    );

    expect(plan.order).toEqual([1, 2, 3, 0]);
  });

  it('does not file a proposal below the minimum value, and says why', () => {
    const plan = planFiling(
      [item('ui', 2), item('docs', 5)],
      empty,
      DEFAULT_LIMITS,
    );

    expect(plan.order).toEqual([1]);
    expect(plan.skipped.get(0)).toBe('польза 2 ниже минимума 3');
  });

  it('holds back a direction that already has open work, counting what this batch adds', () => {
    const state = { openByCategory: { ui: 3, docs: 2 }, filedLast24h: 0 };
    const plan = planFiling(
      [item('ui', 5), item('docs', 5), item('docs', 4)],
      state,
      DEFAULT_LIMITS,
    );

    expect(plan.order).toEqual([1]);
    expect(plan.skipped.get(0)).toContain('уже 3 открытых');
    expect(plan.skipped.get(2)).toContain('уже 3 открытых');
  });

  it('stops at the daily cap, counting what was filed in the last 24 hours', () => {
    const plan = planFiling(
      [item('a', 5), item('b', 5), item('c', 5)],
      { openByCategory: {}, filedLast24h: 3 },
      { ...DEFAULT_LIMITS, dailyIssueCap: 5 },
    );

    expect(plan.order).toEqual([0, 1]);
    expect(plan.skipped.get(2)).toContain('лимит 5');
  });

  it('files nothing when the cap is zero', () => {
    expect(
      planFiling([item('a', 5)], empty, { ...DEFAULT_LIMITS, dailyIssueCap: 0 })
        .order,
    ).toEqual([]);
  });
});

describe('countOpenByCategory', () => {
  it('counts the category labels of open issues and ignores the rest', () => {
    expect(
      countOpenByCategory([
        { labels: ['loop', 'risk:low', 'category:ui'] },
        { labels: ['category:ui', 'category:docs'] },
        { labels: ['bug'] },
      ]),
    ).toEqual({ ui: 2, docs: 1 });
  });
});
