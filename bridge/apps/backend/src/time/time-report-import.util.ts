import { Workbook, CellValue } from 'exceljs';

// The CRM export names the row "Итого" (total) and leaves the notes/off-days
// rows without a numeric hours cell, but "Итого" carries a SUM() formula
// result in the hours column, so it needs an explicit exclusion.
const TOTAL_ROW_LABEL = 'Итого';

const MONTH_NAMES: Record<string, number> = {
  январь: 1,
  января: 1,
  февраль: 2,
  февраля: 2,
  март: 3,
  марта: 3,
  апрель: 4,
  апреля: 4,
  май: 5,
  мая: 5,
  июнь: 6,
  июня: 6,
  июль: 7,
  июля: 7,
  август: 8,
  августа: 8,
  сентябрь: 9,
  сентября: 9,
  октябрь: 10,
  октября: 10,
  ноябрь: 11,
  ноября: 11,
  декабрь: 12,
  декабря: 12,
};

export interface ReportPeriod {
  year: number;
  month: number;
}

export interface ParsedTimeReportEntry {
  taskName: string;
  status: string;
  hours: number;
}

export function extractPeriodFromFilename(
  filename: string,
): ReportPeriod | null {
  const yearMatch = filename.match(/(20\d{2})/);
  if (!yearMatch) return null;

  const lower = filename.toLowerCase();
  // \b doesn't treat Cyrillic letters as word characters, so a plain custom
  // boundary (not preceded/followed by a Cyrillic letter) is used instead to
  // avoid "март" falsely matching inside "марта".
  const monthEntry = Object.entries(MONTH_NAMES).find(([name]) =>
    new RegExp(`(^|[^а-яё])${name}(?![а-яё])`, 'i').test(lower),
  );
  if (!monthEntry) return null;

  return { year: Number(yearMatch[1]), month: monthEntry[1] };
}

function cellText(value: CellValue): string {
  if (value == null) return '';
  if (typeof value === 'object' && 'richText' in value) {
    return value.richText
      .map((part) => part.text)
      .join('')
      .trim();
  }
  return String(value).trim();
}

function cellNumber(value: CellValue): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && 'result' in value) {
    return Number(value.result);
  }
  return NaN;
}

// Data rows start at row 3: row 1 holds the "MM.YYYY" title, row 2 the
// column headers (task name / status / person name). Parsing stops relying
// on structure past that and instead keeps any row with a non-empty task
// name and a finite hours value — this naturally skips the blank filler
// rows and the "Примечания"/"Отпуски..." rows below the table, which have no
// numeric hours cell.
export async function parseTimeReportWorkbook(
  buffer: Buffer,
): Promise<ParsedTimeReportEntry[]> {
  const workbook = new Workbook();
  // exceljs pulls in fast-csv, which ships its own nested (older) @types/node
  // — its Buffer type is structurally incompatible with @types/node's
  // current generic Buffer despite being the same class at runtime, so a
  // plain cast can't satisfy either declaration.
  await workbook.xlsx.load(buffer as any);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const entries: ParsedTimeReportEntry[] = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber < 3) return;

    const taskName = cellText(row.getCell(1).value);
    if (!taskName || taskName === TOTAL_ROW_LABEL) return;

    const hours = cellNumber(row.getCell(3).value);
    if (!Number.isFinite(hours)) return;

    entries.push({
      taskName,
      status: cellText(row.getCell(2).value),
      hours,
    });
  });

  return entries;
}
