import { describe, expect, it } from 'vitest';

import type { RowData } from '../hocs/with-table-sorting';
import { defaultExportSort, sortReportRows, taskNumber } from './export-report';

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

  describe('by task number', () => {
    const numbered = [
      row('120 crm Третья', 'Закрыта', 1),
      row('9 crm Первая', 'В работе', 1),
      row('Без номера', 'Закрыта', 1),
      row('45 crm Вторая', 'Закрыта', 1),
    ];

    it('compares numbers as numbers, not as text (9 before 45 before 120)', () => {
      expect(names(sortReportRows(numbered, { field: 'number', direction: 'asc' }))).toEqual([
        '9 crm Первая',
        '45 crm Вторая',
        '120 crm Третья',
        'Без номера',
      ]);
    });

    it('reverses the numbers on desc but keeps a row without a number last', () => {
      expect(names(sortReportRows(numbered, { field: 'number', direction: 'desc' }))).toEqual([
        '120 crm Третья',
        '45 crm Вторая',
        '9 crm Первая',
        'Без номера',
      ]);
    });
  });
});

describe('taskNumber', () => {
  it('reads the number the name starts with', () => {
    expect(taskNumber('1029 crm Название')).toBe(1029);
    expect(taskNumber('  7 crm')).toBe(7);
  });

  it('is null when the name does not start with digits', () => {
    expect(taskNumber('crm 12 Название')).toBeNull();
    expect(taskNumber('')).toBeNull();
  });
});
