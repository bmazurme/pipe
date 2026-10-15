import { createObjectCsvWriter } from 'csv-writer';

export async function exportToCsv(fileName: string, data: { name: string; status: string; time: number }[]) {
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
