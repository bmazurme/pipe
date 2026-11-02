import { describe, it, expect } from 'vitest';
import type { IssueResponse } from '@reports/shared';

import { formatCreated, toReportRows } from './report-rows';

const issue = (over: Partial<IssueResponse[number]> = {}): IssueResponse[number] => ({
  id: '1',
  iid: '7',
  title: 'Fix it',
  project_id: 10,
  state: 'opened',
  created_at: new Date(2024, 0, 5, 9, 3, 7).toISOString(),
  time_stats: { human_time_estimate: '2h' },
  ...over,
});

describe('toReportRows', () => {
  it('appends a trailing dot to a title without one', () => {
    expect(toReportRows([issue({ title: '  Fix it  ' })], { 10: 'PRJ' })).toEqual([
      { name: '7 PRJ Fix it.', status: 'В работе', time: 2, created: '20240105090307' },
    ]);
  });

  it('keeps an existing trailing dot', () => {
    expect(toReportRows([issue({ title: 'Done.' })], { 10: 'PRJ' })[0].name).toBe('7 PRJ Done.');
  });

  it('uses an empty prefix for an unknown project id', () => {
    expect(toReportRows([issue({ project_id: 99 })], {})[0].name).toBe('7  Fix it.');
  });

  it('uses 0 when time_stats is missing', () => {
    expect(toReportRows([issue({ time_stats: undefined })], {})[0].time).toBe(0);
  });

  it('maps closed state and keeps input order', () => {
    const rows = toReportRows([issue({ iid: '1', state: 'closed' }), issue({ iid: '2' })], {});
    expect(rows.map((r) => [r.name.split(' ')[0], r.status])).toEqual([
      ['1', 'Закрыта'],
      ['2', 'В работе'],
    ]);
  });
});

describe('formatCreated', () => {
  it('writes the local time as YYYYMMDDHHMMSS, zero-padded', () => {
    expect(formatCreated(new Date(2024, 10, 3, 4, 5, 6).toISOString())).toBe('20241103040506');
  });

  it('is empty when GitLab gave no usable date', () => {
    expect(formatCreated(undefined)).toBe('');
    expect(formatCreated('')).toBe('');
    expect(formatCreated('not a date')).toBe('');
  });
});
