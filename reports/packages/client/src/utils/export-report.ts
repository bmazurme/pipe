import type ExcelJS from 'exceljs';
import type { MonthKeyType } from '@reports/shared';

import type { RowData } from '../hocs/with-table-sorting';

const monthNames: Record<MonthKeyType, string> = {
  '1': 'январь',
  '2': 'февраль',
  '3': 'март',
  '4': 'апрель',
  '5': 'май',
  '6': 'июнь',
  '7': 'июль',
  '8': 'август',
  '9': 'сентябрь',
  '10': 'октябрь',
  '11': 'ноябрь',
  '12': 'декабрь',
};

const thinBorder: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
};

export type ExportSortField = 'number' | 'created' | 'name' | 'status' | 'time';
export type ExportSortDirection = 'asc' | 'desc';
export type ExportSort = { field: ExportSortField; direction: ExportSortDirection };

// What the export did before the person could choose: the longest tasks first.
export const defaultExportSort: ExportSort = { field: 'time', direction: 'desc' };

// The server builds a row's name as `<issue number> <project> <title>`, so the number is the digits the name starts with.
export function taskNumber(name: string): number | null {
  const match = /^\s*(\d+)/.exec(name);

  return match ? Number(match[1]) : null;
}

function compareRows(a: RowData, b: RowData, field: ExportSortField): number {
  if (field === 'time') return a.time - b.time;
  if (field === 'number') return (taskNumber(a.name) ?? 0) - (taskNumber(b.name) ?? 0);
  // YYYYMMDDHHMMSS has a fixed width, so comparing it as text is comparing the moments.
  if (field === 'created') return a.created.localeCompare(b.created);

  return a[field].localeCompare(b[field], 'ru');
}

// A row without the value to sort by (no number in its name, no creation date) has nothing to compare:
// it stays after the others in either direction.
function hasSortKey(item: RowData, field: ExportSortField): boolean {
  if (field === 'number') return taskNumber(item.name) !== null;
  if (field === 'created') return item.created !== '';

  return true;
}

// Only tasks with time spent go into the file; the sort is stable, so equal values keep the order of the table.
export function sortReportRows(report: RowData[], { field, direction }: ExportSort): RowData[] {
  const sign = direction === 'asc' ? 1 : -1;

  return report
    .filter((item) => item.time > 0)
    .sort((a, b) => {
      const aKeyed = hasSortKey(a, field);
      const bKeyed = hasSortKey(b, field);

      if (!aKeyed || !bKeyed) return Number(!aKeyed) - Number(!bKeyed);

      return sign * compareRows(a, b, field);
    });
}

// Sorted by creation date, the file shows that date (YYYYMMDDHHMMSS) where the issue number stood in the name.
export function exportedName(item: RowData, field: ExportSortField): string {
  if (field !== 'created' || item.created === '') return item.name;

  return /^\s*\d+/.test(item.name) ? item.name.replace(/^\s*\d+/, item.created) : `${item.created} ${item.name}`;
}

type ExportReportParams = {
  report: RowData[];
  month: MonthKeyType;
  year: string;
  employee: string;
  company: string;
  offDays: number;
  sort?: ExportSort;
};

export async function exportReport({
  report,
  month,
  year,
  employee,
  company,
  offDays,
  sort = defaultExportSort,
}: ExportReportParams) {
  // Loaded on demand — exceljs is ~1 MB and only needed when the user exports
  const { default: ExcelJSRuntime } = await import('exceljs');
  const workbook = new ExcelJSRuntime.Workbook();
  const sheet = workbook.addWorksheet('Лист1');

  sheet.columns = [
    { width: 77.43 },
    { width: 20.71 },
    { width: 17.71 },
    { width: 15.43 },
  ];

  sheet.getCell('C1').value = `${month.padStart(2, '0')}.${year}`;
  sheet.getCell('C1').alignment = { horizontal: 'right' };

  sheet.getCell('A2').value = 'Наименование задачи';
  sheet.getCell('B2').value = 'Статус задачи';
  sheet.getCell('C2').value = employee;
  [sheet.getCell('A2'), sheet.getCell('B2'), sheet.getCell('C2')].forEach((cell) => {
    cell.font = { bold: true };
  });
  sheet.getCell('B2').alignment = { horizontal: 'center' };

  const dataStartRow = 3;
  const rows = sortReportRows(report, sort);

  rows.forEach((item, index) => {
    const row = sheet.getRow(dataStartRow + index);

    row.getCell(1).value = exportedName(item, sort.field);
    row.getCell(2).value = item.status;
    row.getCell(3).value = item.time;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.alignment = {
        vertical: 'middle',
        wrapText: true,
        horizontal: colNumber === 2 || colNumber === 3 ? 'center' : undefined,
      };
      cell.border = thinBorder;
    });
  });

  const dataEndRow = dataStartRow + rows.length - 1;
  const totalRow = sheet.getRow(dataEndRow + 1);

  totalRow.getCell(1).value = 'Итого';
  totalRow.getCell(3).value = { formula: `SUM(C${dataStartRow}:C${dataEndRow})` };
  totalRow.font = { bold: true };
  totalRow.getCell(3).alignment = { horizontal: 'center' };

  sheet.getCell(`A${dataEndRow + 3}`).value = 'Примечания';
  sheet.getCell(`A${dataEndRow + 5}`).value = 'Отпуски/Отгулы/Больничные';
  if (offDays > 0) {
    sheet.getCell(`A${dataEndRow + 6}`).value = offDays * 8;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = `Отчет - ${year} ${monthNames[month]} CRM (${employee}) - ${company}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}
