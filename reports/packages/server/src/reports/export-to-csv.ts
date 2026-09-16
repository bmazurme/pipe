import { createObjectCsvWriter } from 'csv-writer';

export function exportToCsv(fileName: string, data: { name: string; status: string; time: number }[]) {
  const csvWriter = createObjectCsvWriter({
    path: fileName,
    header: [
      { id: 'name', title: 'name' },
      { id: 'status', title: 'status' },
      { id: 'time', title: 'time' }
    ],
    encoding: 'utf-8',
  });

  csvWriter.writeRecords(data).then(() => {
    console.log('CSV файл сохранён');
  });
}
