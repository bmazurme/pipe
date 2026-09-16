import { Workbook } from 'exceljs';

import {
  extractPeriodFromFilename,
  parseTimeReportWorkbook,
} from './time-report-import.util';

describe('extractPeriodFromFilename', () => {
  it('reads year and nominative month name', () => {
    expect(
      extractPeriodFromFilename(
        'Отчет - 2026 май CRM (Мазур Богдан) - Айфелл.xlsx',
      ),
    ).toEqual({ year: 2026, month: 5 });
  });

  it('reads year and genitive month name', () => {
    expect(extractPeriodFromFilename('report-2025-декабря.xlsx')).toEqual({
      year: 2025,
      month: 12,
    });
  });

  it('does not confuse "март" with "марта"', () => {
    expect(extractPeriodFromFilename('Отчет - 2026 марта.xlsx')).toEqual({
      year: 2026,
      month: 3,
    });
  });

  it('returns null when the year is missing', () => {
    expect(extractPeriodFromFilename('Отчет - май.xlsx')).toBeNull();
  });

  it('returns null when no month name is present', () => {
    expect(extractPeriodFromFilename('Отчет - 2026.xlsx')).toBeNull();
  });
});

describe('parseTimeReportWorkbook', () => {
  async function buildWorkbookBuffer(): Promise<Buffer> {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Sheet1');

    sheet.getCell('C1').value = '07.2026';
    sheet.addRow(['Наименование задачи', 'Статус задачи', 'Мазур Богдан']);
    sheet.addRow(['Задача 1', 'В работе', 40]);
    sheet.addRow(['Задача 2', 'Закрыта', 8]);
    sheet.addRow([]);
    sheet.addRow([]);
    const totalRow = sheet.addRow(['Итого']);
    totalRow.getCell(3).value = { formula: 'SUM(C3:C4)', result: 48 };
    sheet.addRow(['Примечания']);
    sheet.addRow(['Отпуски/Отгулы/Больничные']);

    return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  }

  it('extracts task rows and skips the header, blank, total and footer rows', async () => {
    const buffer = await buildWorkbookBuffer();

    await expect(parseTimeReportWorkbook(buffer)).resolves.toEqual([
      { taskName: 'Задача 1', status: 'В работе', hours: 40 },
      { taskName: 'Задача 2', status: 'Закрыта', hours: 8 },
    ]);
  });

  it('returns an empty list for a workbook with no worksheets', async () => {
    const workbook = new Workbook();
    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;

    await expect(parseTimeReportWorkbook(buffer)).resolves.toEqual([]);
  });
});
