import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { getProps, addOffDays, removeOffDay } from './props';

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
