import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { getProps, addOffDays, removeOffDay, getAllOffDaysByYear, importDayOffs } from './props';

const __dirname = dirname(fileURLToPath(import.meta.url));
const propsPath = join(__dirname, 'props.json');

let originalContent: string;

beforeEach(() => {
  originalContent = readFileSync(propsPath, 'utf-8');
});

afterEach(() => {
  writeFileSync(propsPath, originalContent);
});

describe('getProps', () => {
  it('returns the year config', () => {
    const props = getProps('2025');

    expect(props).toHaveProperty('holidays');
    expect(props).toHaveProperty('shortDays');
    expect(props).toHaveProperty('badDays');
    expect(props).toHaveProperty('offDays');
  });
});

describe('with a temp props file', () => {
  let tempDir: string;
  let tempPath: string;
  let previousEnv: string | undefined;

  const seed = {
    '2030': {
      holidays: ['2030-01-02', '2030-01-01'],
      shortDays: [],
      badDays: ['2030-03-03'],
      offDays: ['2030-05-02'],
    },
  };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'reports-props-'));
    tempPath = join(tempDir, 'props.json');
    writeFileSync(tempPath, JSON.stringify(seed));
    previousEnv = process.env.REPORTS_PROPS_PATH;
    process.env.REPORTS_PROPS_PATH = tempPath;
  });

  afterEach(() => {
    if (previousEnv === undefined) {
      delete process.env.REPORTS_PROPS_PATH;
    } else {
      process.env.REPORTS_PROPS_PATH = previousEnv;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('getProps returns empty arrays for an unknown year without writing the file', () => {
    const before = readFileSync(tempPath, 'utf-8');

    expect(getProps(1999)).toEqual({ holidays: [], shortDays: [], badDays: [], offDays: [] });
    expect(readFileSync(tempPath, 'utf-8')).toBe(before);
  });

  it('importDayOffs merges with existing data, dedupes and sorts', () => {
    const result = importDayOffs('2030', {
      holidays: ['2030-01-01', '2030-01-03'],
      shortDays: ['2030-02-02', '2030-02-01', '2030-02-02'],
      badDays: [],
      offDays: ['2030-05-01', '2030-05-02'],
    });

    expect(result).toEqual({
      holidays: ['2030-01-01', '2030-01-02', '2030-01-03'],
      shortDays: ['2030-02-01', '2030-02-02'],
      badDays: ['2030-03-03'],
      offDays: ['2030-05-01', '2030-05-02'],
    });
    expect(getProps('2030')).toEqual(result);
  });

  it('importDayOffs creates a new year', () => {
    const imported = { holidays: ['2031-01-02', '2031-01-01'], shortDays: [], badDays: [], offDays: ['2031-06-01'] };

    const result = importDayOffs(2031, imported);

    expect(result.holidays).toEqual(['2031-01-01', '2031-01-02']);
    expect(getProps('2031')).toEqual(result);
    expect(getProps('2030')).toEqual(seed['2030']);
  });
});

describe('addOffDays', () => {
  it('adds new dates to offDays', () => {
    const before = getProps('2025').offDays.length;

    const result = addOffDays('2025', ['2099-01-01', '2099-01-02']);

    expect(result.offDays).toContain('2099-01-01');
    expect(result.offDays).toContain('2099-01-02');
    expect(result.offDays.length).toBe(before + 2);
  });

  it('does not add duplicate dates', () => {
    addOffDays('2025', ['2099-02-01']);
    const before = getProps('2025').offDays.length;

    const result = addOffDays('2025', ['2099-02-01']);

    expect(result.offDays.length).toBe(before);
  });
});

describe('getAllOffDaysByYear', () => {
  it('returns only offDays, keyed by year, for every year on file', () => {
    addOffDays('2025', ['2099-05-01']);

    const byYear = getAllOffDaysByYear();

    expect(byYear['2025']).toContain('2099-05-01');
    expect(byYear['2025']).not.toHaveProperty('holidays');
    expect(Object.keys(byYear).length).toBeGreaterThan(0);
  });
});

describe('removeOffDay', () => {
  it('removes an existing off day', () => {
    addOffDays('2025', ['2099-03-01']);
    const before = getProps('2025').offDays.length;

    const result = removeOffDay('2025', '2099-03-01');

    expect(result.offDays).not.toContain('2099-03-01');
    expect(result.offDays.length).toBe(before - 1);
  });

  it('is a no-op when the date is not present', () => {
    const before = getProps('2025').offDays.length;

    const result = removeOffDay('2025', '2099-04-01');

    expect(result.offDays.length).toBe(before);
  });
});
