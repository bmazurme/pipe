import { createObjectCsvWriter } from 'csv-writer';

import type { ReportRow } from './report-rows';

export async function exportToCsv(fileName: string, data: ReportRow[]) {
  const csvWriter = createObjectCsvWriter({
    path: fileName,
    header: [
      { id: 'name', title: 'name' },
      { id: 'status', title: 'status' },
      { id: 'time', title: 'time' }
    ],
    encoding: 'utf-8',
  });

  await csvWriter.writeRecords(data);
  console.log('CSV файл сохранён');
}
