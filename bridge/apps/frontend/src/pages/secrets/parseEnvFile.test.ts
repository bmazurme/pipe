import { describe, expect, it } from 'vitest';

import { parseEnvFile } from './parseEnvFile';

describe('parseEnvFile', () => {
  it('parses plain pairs and ignores comments and blank lines', () => {
    const r = parseEnvFile('# c\n\nA=1\n  # indented\nB=two\n');
    expect(r.entries).toEqual([
      { name: 'A', value: '1' },
      { name: 'B', value: 'two' },
    ]);
    expect(r.invalidLines).toEqual([]);
  });

  it('accepts the export prefix', () => {
    expect(parseEnvFile('export A=1').entries).toEqual([{ name: 'A', value: '1' }]);
  });

  it('strips one pair of matching quotes only', () => {
    const r = parseEnvFile(`A="x y"\nB='z'\nC="mixed'\nD=""q""`);
    expect(r.entries.map((e) => e.value)).toEqual(['x y', 'z', `"mixed'`, '"q"']);
  });

  it('keeps = inside a value', () => {
    expect(parseEnvFile('A=b=c').entries).toEqual([{ name: 'A', value: 'b=c' }]);
  });

  it('handles CRLF line endings', () => {
    const r = parseEnvFile('A=1\r\nB=2\r\n');
    expect(r.entries).toEqual([
      { name: 'A', value: '1' },
      { name: 'B', value: '2' },
    ]);
  });

  it('reports invalid lines with 1-based numbers', () => {
    const r = parseEnvFile('A=1\nnoequals\n=v\nEMPTY=\nQ=""\nB=2');
    expect(r.entries.map((e) => e.name)).toEqual(['A', 'B']);
    expect(r.invalidLines).toEqual([2, 3, 4, 5]);
  });
});
