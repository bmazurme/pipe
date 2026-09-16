import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { applyDictionary } from './dictionary.js';

describe('applyDictionary', () => {
  const toRemote = new Map([
    ['prod-db.internal.example.com', '{{DB_HOST}}'],
    ['db', '{{DB}}'],
  ]);
  const toLocal = new Map([...toRemote].map(([k, v]) => [v, k]));

  it('replaces real values with placeholders', () => {
    assert.equal(applyDictionary('host: prod-db.internal.example.com', toRemote).result, 'host: {{DB_HOST}}');
  });

  it('replaces placeholders back with real values', () => {
    assert.equal(applyDictionary('host: {{DB_HOST}}', toLocal).result, 'host: prod-db.internal.example.com');
  });

  it('matches the longest key first so a shorter key does not shadow it', () => {
    assert.equal(
      applyDictionary('prod-db.internal.example.com and db', toRemote).result,
      '{{DB_HOST}} and {{DB}}',
    );
  });

  it('does not match inside a longer identifier (word-boundary safe)', () => {
    assert.equal(applyDictionary('userId', toRemote).result, 'userId');
  });

  it('passes text through unchanged for an empty dictionary', () => {
    assert.equal(applyDictionary('anything', new Map()).result, 'anything');
  });

  it('counts the number of substitutions made', () => {
    assert.equal(applyDictionary('db and db again', toRemote).count, 2);
  });
});
