import { describe, expect, it } from 'vitest';

import { PurgeEntry } from '../../store/api/purge-api/endpoints';
import {
  applyDictionary,
  buildDictionary,
  mask,
  parseImportedEntries,
  suggestUniqueValue,
} from './purgeUtils';

function entry(id: number, key: string, value: string): PurgeEntry {
  return { id, key, value, createdAt: new Date().toISOString() };
}

describe('parseImportedEntries', () => {
  it('parses a plain array of { key, value } — the ntlstl/purge export format', () => {
    const raw = JSON.stringify([
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
    ]);
    expect(parseImportedEntries(raw)).toEqual([
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
    ]);
  });

  it('accepts an entry with an empty value, matching ntlstl/purge', () => {
    const raw = JSON.stringify([{ key: 'a', value: '' }]);
    expect(parseImportedEntries(raw)).toEqual([{ key: 'a', value: '' }]);
  });

  it('coerces a non-string value instead of dropping the entry', () => {
    const raw = JSON.stringify([{ key: 'a', value: 42 }]);
    expect(parseImportedEntries(raw)).toEqual([{ key: 'a', value: '42' }]);
  });

  it('trims whitespace from key and value', () => {
    const raw = JSON.stringify([{ key: '  a  ', value: '  1  ' }]);
    expect(parseImportedEntries(raw)).toEqual([{ key: 'a', value: '1' }]);
  });

  it('throws identifying the offending index when a key is missing', () => {
    const raw = JSON.stringify([{ key: 'a', value: '1' }, { value: '2' }]);
    expect(() => parseImportedEntries(raw)).toThrow('Запись №2');
  });

  it('throws when the key is an empty/whitespace string', () => {
    const raw = JSON.stringify([{ key: '   ', value: '1' }]);
    expect(() => parseImportedEntries(raw)).toThrow('Запись №1');
  });

  it('throws for invalid JSON', () => {
    expect(() => parseImportedEntries('not json')).toThrow('JSON');
  });

  it('throws when the JSON is not an array', () => {
    expect(() => parseImportedEntries(JSON.stringify({ a: 1 }))).toThrow('массив');
  });

  it('throws for an empty array', () => {
    expect(() => parseImportedEntries('[]')).toThrow('ни одной пары');
  });
});

describe('buildDictionary', () => {
  const entries = [entry(1, 'foo', 'bar'), entry(2, 'baz', 'qux')];

  it('maps key -> value in keyToValue direction', () => {
    const dict = buildDictionary(entries, 'keyToValue');
    expect(dict.get('foo')).toBe('bar');
    expect(dict.get('baz')).toBe('qux');
  });

  it('maps value -> key in valueToKey direction', () => {
    const dict = buildDictionary(entries, 'valueToKey');
    expect(dict.get('bar')).toBe('foo');
  });

  it('keeps the first entry when two share a lookup key', () => {
    const dict = buildDictionary([entry(1, 'a', 'x'), entry(2, 'a', 'y')], 'keyToValue');
    expect(dict.get('a')).toBe('x');
  });
});

describe('applyDictionary', () => {
  it('replaces whole-word matches and counts them', () => {
    const dict = new Map([['foo', 'bar']]);
    expect(applyDictionary('foo and foo again', dict)).toEqual({
      result: 'bar and bar again',
      count: 2,
    });
  });

  it('does not replace inside a larger word', () => {
    const dict = new Map([['foo', 'bar']]);
    expect(applyDictionary('foobar', dict)).toEqual({ result: 'foobar', count: 0 });
  });

  it('prefers the longer match when one key is a prefix of another', () => {
    const dict = new Map([
      ['foo', 'X'],
      ['foobar', 'Y'],
    ]);
    expect(applyDictionary('foobar', dict)).toEqual({ result: 'Y', count: 1 });
  });

  it('matches Cyrillic word boundaries', () => {
    const dict = new Map([['привет', 'hello']]);
    expect(applyDictionary('привет мир', dict)).toEqual({ result: 'hello мир', count: 1 });
  });

  it('is a no-op for an empty dictionary or empty text', () => {
    expect(applyDictionary('text', new Map())).toEqual({ result: 'text', count: 0 });
    expect(applyDictionary('', new Map([['a', 'b']]))).toEqual({ result: '', count: 0 });
  });
});

describe('suggestUniqueValue', () => {
  it('returns a value of the requested length', () => {
    expect(suggestUniqueValue(6, new Set())).toHaveLength(6);
  });

  it('returns an empty string for length 0', () => {
    expect(suggestUniqueValue(0, new Set())).toBe('');
  });

  it('avoids a small set of taken values', () => {
    const taken = new Set(['a', 'b', 'c']);
    const result = suggestUniqueValue(1, taken);
    expect(taken.has(result)).toBe(false);
  });
});

describe('mask', () => {
  it('replaces every character with a dot, keeping the length', () => {
    expect(mask('secret')).toBe('••••••');
  });

  it('returns an empty string for an empty value', () => {
    expect(mask('')).toBe('');
  });

  it('caps the mask length for very long values', () => {
    expect(mask('x'.repeat(500))).toHaveLength(40);
  });
});
