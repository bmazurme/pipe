import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeJsonFileSync } from '@pipe/protocol';

export type YearProps = {
  holidays: string[];
  shortDays: string[];
  badDays: string[];
  offDays: string[];
};

const __dirname = dirname(fileURLToPath(import.meta.url));
// REPORTS_PROPS_PATH lets tests point at a temp file instead of the real props.json.
const getPropsPath = () => process.env.REPORTS_PROPS_PATH ?? join(__dirname, 'props.json');

const emptyYearProps = (): YearProps => ({ holidays: [], shortDays: [], badDays: [], offDays: [] });

const readProps = (): Record<string, YearProps> => {
  return JSON.parse(readFileSync(getPropsPath(), 'utf-8'));
};

export const getProps = (year: number | string | string[]): YearProps => {
  const props = readProps();

  return props[String(year)] ?? emptyYearProps();
};

// For the settings-transfer bundle — only offDays travel (see
// SettingsBundleType's comment for why holidays/shortDays/badDays don't).
export const getAllOffDaysByYear = (): Record<string, string[]> => {
  const props = readProps();

  return Object.fromEntries(Object.entries(props).map(([year, yearProps]) => [year, yearProps.offDays]));
};

export const addOffDays = (year: number | string | string[], dates: string[]): YearProps => {
  const props = readProps();
  const key = String(year);
  const isNewYear = !props[key];
  const yearProps = props[key] ?? emptyYearProps();
  props[key] = yearProps;

  const newDates = [...new Set(dates)].filter((date) => !yearProps.offDays.includes(date));

  if (newDates.length > 0 || isNewYear) {
    yearProps.offDays.push(...newDates);
    writeJsonFileSync(getPropsPath(), props);
  }

  return yearProps;
};

export const importDayOffs = (year: number | string | string[], imported: YearProps): YearProps => {
  const props = readProps();
  const key = String(year);
  const existing = props[key] ?? emptyYearProps();

  const merge = (a: string[], b: string[]) => [...new Set([...a, ...b])].sort();

  const yearProps: YearProps = {
    holidays: merge(existing.holidays, imported.holidays),
    shortDays: merge(existing.shortDays, imported.shortDays),
    badDays: merge(existing.badDays, imported.badDays),
    offDays: merge(existing.offDays, imported.offDays),
  };

  props[key] = yearProps;
  writeJsonFileSync(getPropsPath(), props);

  return yearProps;
};

export const removeOffDay = (year: number | string | string[], date: string | string[]): YearProps => {
  const props = readProps();
  const yearProps = props[String(year)];

  // Nothing to remove from a year that isn't stored; don't create it as a side effect.
  if (!yearProps) {
    return emptyYearProps();
  }

  const dateStr = String(date);

  if (yearProps.offDays.includes(dateStr)) {
    yearProps.offDays = yearProps.offDays.filter((d) => d !== dateStr);
    writeJsonFileSync(getPropsPath(), props);
  }

  return yearProps;
};
