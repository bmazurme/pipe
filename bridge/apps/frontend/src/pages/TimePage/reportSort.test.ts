import { describe, expect, it } from 'vitest';

import {
  ariaSort,
  nextSort,
  sortReportEntries,
  type SortableReportEntry,
} from './reportSort';

const entries: SortableReportEntry[] = [
  { id: 1, taskName: 'Задача 10', status: 'В работе', hours: 4 },
  { id: 2, taskName: 'Задача 2', status: 'Готово', hours: 12 },
  { id: 3, taskName: 'Аудит', status: 'В работе', hours: 4 },
];

const names = (rows: SortableReportEntry[]) => rows.map((row) => row.taskName);

describe('nextSort', () => {
  it('starts a fresh column ascending', () => {
    expect(nextSort(null, 'hours')).toEqual({ column: 'hours', direction: 'asc' });
  });

  it('cycles ascending → descending → unsorted on the same column', () => {
    const asc = nextSort(null, 'taskName');
    const desc = nextSort(asc, 'taskName');

    expect(desc).toEqual({ column: 'taskName', direction: 'desc' });
    expect(nextSort(desc, 'taskName')).toBeNull();
  });

  it('restarts ascending when switching columns mid-cycle', () => {
    const desc = { column: 'taskName', direction: 'desc' } as const;

    expect(nextSort(desc, 'hours')).toEqual({ column: 'hours', direction: 'asc' });
  });
});

describe('sortReportEntries', () => {
  it('keeps the imported order when unsorted', () => {
    expect(names(sortReportEntries(entries, null))).toEqual([
      'Задача 10',
      'Задача 2',
      'Аудит',
    ]);
  });

  it('does not mutate the source array', () => {
    const source = [...entries];
    sortReportEntries(source, { column: 'hours', direction: 'desc' });

    expect(names(source)).toEqual(names(entries));
  });

  it('sorts hours numerically, not as text', () => {
    const sorted = sortReportEntries(entries, { column: 'hours', direction: 'desc' });

    expect(sorted.map((row) => row.hours)).toEqual([12, 4, 4]);
  });

  it('orders Cyrillic names naturally, with embedded numbers in order', () => {
    const sorted = sortReportEntries(entries, { column: 'taskName', direction: 'asc' });

    expect(names(sorted)).toEqual(['Аудит', 'Задача 2', 'Задача 10']);
  });

  it('breaks ties by imported order in both directions', () => {
    const asc = sortReportEntries(entries, { column: 'status', direction: 'asc' });
    const desc = sortReportEntries(entries, { column: 'status', direction: 'desc' });

    // Rows 1 and 3 share a status, so they stay in id order either way.
    expect(asc.map((row) => row.id)).toEqual([1, 3, 2]);
    expect(desc.map((row) => row.id)).toEqual([2, 1, 3]);
  });
});

describe('ariaSort', () => {
  it('reports the state only for the sorted column', () => {
    const sort = { column: 'hours', direction: 'asc' } as const;

    expect(ariaSort(sort, 'hours')).toBe('ascending');
    expect(ariaSort(sort, 'taskName')).toBe('none');
    expect(ariaSort(null, 'hours')).toBe('none');
  });
});
