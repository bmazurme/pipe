import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

import { addOffDays, removeOffDay } from './props';
import { handleAddOffDay, isDateStringArray } from './handler';

const year2024 = { holidays: ['2024-01-01'], shortDays: [], badDays: [], offDays: ['2024-05-02'] };

let dir: string;
let file: string;

const readFile = () => JSON.parse(readFileSync(file, 'utf-8'));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'props-test-'));
  file = join(dir, 'props.json');
  writeFileSync(file, JSON.stringify({ '2024': year2024 }));
  process.env.REPORTS_PROPS_PATH = file;
});

afterEach(() => {
  delete process.env.REPORTS_PROPS_PATH;
  rmSync(dir, { recursive: true, force: true });
});

describe('addOffDays', () => {
  it('creates an unknown year and stores the dates', () => {
    const result = addOffDays(2030, ['2030-03-04']);

    expect(result).toEqual({ holidays: [], shortDays: [], badDays: [], offDays: ['2030-03-04'] });
    expect(readFile()['2030'].offDays).toEqual(['2030-03-04']);
    expect(readFile()['2024']).toEqual(year2024);
  });

  it('appends only new dates to an existing year', () => {
    addOffDays(2024, ['2024-05-02', '2024-06-03']);

    expect(readFile()['2024'].offDays).toEqual(['2024-05-02', '2024-06-03']);
  });
});

describe('removeOffDay', () => {
  it('does not throw or persist for an unknown year', () => {
    expect(() => removeOffDay(2030, '2030-03-04')).not.toThrow();
    expect(readFile()['2030']).toBeUndefined();
  });

  it('removes a date from an existing year', () => {
    removeOffDay(2024, '2024-05-02');

    expect(readFile()['2024'].offDays).toEqual([]);
  });
});

describe('isDateStringArray', () => {
  it('accepts arrays of YYYY-MM-DD strings', () => {
    expect(isDateStringArray(['2024-01-02'])).toBe(true);
    expect(isDateStringArray([])).toBe(true);
  });

  it.each([undefined, null, 'abc', { 0: '2024-01-02' }, [1], ['2024-1-2'], ['2024-13-45'], ['x']])(
    'rejects %j',
    (value) => {
      expect(isDateStringArray(value)).toBe(false);
    },
  );
});

describe('handleAddOffDay validation', () => {
  const run = async (body: unknown) => {
    const written: string[] = [];
    const res = {
      setHeader: vi.fn(),
      write: (chunk: string) => written.push(chunk),
      end: vi.fn(),
    } as unknown as Response;
    const req = { params: { id: '2030' }, body } as unknown as Request<Record<string, string>>;

    vi.spyOn(console, 'error').mockImplementation(() => {});
    await handleAddOffDay(req, res);

    return written.map((line) => JSON.parse(line));
  };

  it.each([
    ['missing dates', {}],
    ['non-array dates', { dates: '2030-03-04' }],
    ['malformed date', { dates: ['2030-3-4'] }],
  ])('emits an error event and persists nothing for %s', async (_name, body) => {
    const events = await run(body);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    expect(readFile()['2030']).toBeUndefined();
  });

  it('persists valid dates for a new year', async () => {
    const events = await run({ dates: ['2030-03-04'] });

    expect(events[0].type).toBe('message');
    expect(readFile()['2030'].offDays).toEqual(['2030-03-04']);
  });
});
