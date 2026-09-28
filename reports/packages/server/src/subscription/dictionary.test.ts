import { describe, it, expect } from 'vitest';

import { applyDictionary, applyDictionaryWithCount } from './dictionary';

describe('applyDictionary', () => {
  const entries = [
    { key: 'prod-db.internal.example.com', value: '{{DB_HOST}}' },
    { key: 'db', value: '{{DB}}' },
  ];

  it('replaces real values with placeholders (toRemote)', () => {
    expect(applyDictionary('host: prod-db.internal.example.com', entries, 'toRemote'))
      .toBe('host: {{DB_HOST}}');
  });

  it('replaces placeholders back with real values (toLocal)', () => {
    expect(applyDictionary('host: {{DB_HOST}}', entries, 'toLocal')).toBe('host: prod-db.internal.example.com');
  });

  it('matches the longest key first so a shorter key does not shadow it', () => {
    expect(applyDictionary('prod-db.internal.example.com and db', entries, 'toRemote'))
      .toBe('{{DB_HOST}} and {{DB}}');
  });

  it('does not match inside a longer identifier (word-boundary safe)', () => {
    expect(applyDictionary('userId', entries, 'toRemote')).toBe('userId');
  });

  it('passes text through unchanged for an empty dictionary', () => {
    expect(applyDictionary('anything', [], 'toRemote')).toBe('anything');
  });
});

describe('applyDictionaryWithCount', () => {
  const entries = [
    { key: 'prod-db.internal.example.com', value: '{{DB_HOST}}' },
    { key: 'db', value: '{{DB}}' },
  ];

  it('reports how many replacements were made', () => {
    expect(applyDictionaryWithCount('prod-db.internal.example.com and db', entries, 'toRemote'))
      .toEqual({ result: '{{DB_HOST}} and {{DB}}', count: 2 });
  });

  it('reports zero when nothing matches', () => {
    expect(applyDictionaryWithCount('anything', entries, 'toRemote')).toEqual({ result: 'anything', count: 0 });
  });
});
