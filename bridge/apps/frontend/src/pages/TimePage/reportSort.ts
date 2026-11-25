export type ReportSortColumn = 'taskName' | 'status' | 'hours';
export type ReportSortDirection = 'asc' | 'desc';

export interface ReportSort {
  column: ReportSortColumn;
  direction: ReportSortDirection;
}

/** The fields a row needs to be sortable — `id` carries the imported order. */
export interface SortableReportEntry {
  id: number;
  taskName: string;
  status: string;
  hours: number;
}

/**
 * Clicking a column cycles ascending → descending → unsorted. The third state
 * matters here: the imported order is the CRM's own, and there is no other way
 * back to it short of switching months and back.
 */
export function nextSort(
  current: ReportSort | null,
  column: ReportSortColumn,
): ReportSort | null {
  if (current?.column !== column) {
    return { column, direction: 'asc' };
  }

  return current.direction === 'asc' ? { column, direction: 'desc' } : null;
}

// `numeric` so "Задача 2" sorts before "Задача 10", and a base sensitivity so
// case and accents don't split otherwise-identical task names apart.
const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });

export function sortReportEntries<T extends SortableReportEntry>(
  entries: readonly T[],
  sort: ReportSort | null,
): T[] {
  if (!sort) {
    return [...entries];
  }

  const factor = sort.direction === 'asc' ? 1 : -1;

  return [...entries].sort((a, b) => {
    const diff =
      sort.column === 'hours'
        ? a.hours - b.hours
        : collator.compare(a[sort.column], b[sort.column]);

    // Ties fall back to the imported order — and deliberately don't flip with
    // the direction, so reversing a sort doesn't also shuffle equal rows.
    return diff === 0 ? a.id - b.id : diff * factor;
  });
}

export function ariaSort(
  sort: ReportSort | null,
  column: ReportSortColumn,
): 'ascending' | 'descending' | 'none' {
  if (sort?.column !== column) {
    return 'none';
  }

  return sort.direction === 'asc' ? 'ascending' : 'descending';
}
