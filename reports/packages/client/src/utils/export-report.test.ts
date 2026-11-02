import { describe, expect, it } from 'vitest';

import type { RowData } from '../hocs/with-table-sorting';
import { defaultExportSort, sortReportRows } from './export-report';

const row = (name: string, status: string, time: number): RowData => ({
  id: name,
  name,
  status,
  time,
  meta: { sort: true },
});

const report = [
  row('Бета', 'В работе', 2),
  row('Альфа', 'Закрыта', 5),
  row('Без времени', 'Закрыта', 0),
  row('Гамма', 'В работе', 5),
];

const names = (rows: RowData[]) => rows.map((item) => item.name);

describe('sortReportRows', () => {
  it('sorts by hours, longest first, by default — as before the choice existed', () => {
    expect(names(sortReportRows(report, defaultExportSort))).toEqual(['Альфа', 'Гамма', 'Бета']);
  });

  it('sorts by hours ascending', () => {
    expect(names(sortReportRows(report, { field: 'time', direction: 'asc' }))).toEqual(['Бета', 'Альфа', 'Гамма']);
  });

  it('sorts by task name in either direction', () => {
    expect(names(sortReportRows(report, { field: 'name', direction: 'asc' }))).toEqual(['Альфа', 'Бета', 'Гамма']);
    expect(names(sortReportRows(report, { field: 'name', direction: 'desc' }))).toEqual(['Гамма', 'Бета', 'Альфа']);
  });

  it('sorts by status, keeping the table order among equal statuses', () => {
    expect(names(sortReportRows(report, { field: 'status', direction: 'asc' }))).toEqual(['Бета', 'Гамма', 'Альфа']);
  });

  it('leaves tasks without time out and does not reorder the input', () => {
    const before = names(report);

    expect(names(sortReportRows(report, { field: 'name', direction: 'asc' }))).not.toContain('Без времени');
    expect(names(report)).toEqual(before);
  });
});
