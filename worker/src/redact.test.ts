import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { makeRedactor, maxSecretLength } from './redact.js';

describe('makeRedactor', () => {
  it('is a no-op without secrets', () => {
    assert.equal(makeRedactor([])('hello'), 'hello');
    assert.equal(makeRedactor([undefined, null, ''])('hello'), 'hello');
  });

  it('masks every occurrence of every secret', () => {
    const redact = makeRedactor(['secret-token-123', 'other-key-456789']);
    assert.equal(redact('a secret-token-123 b secret-token-123 c other-key-456789'), 'a [redacted] b [redacted] c [redacted]');
  });

  it('ignores short values', () => {
    assert.equal(makeRedactor(['short'])('a short b'), 'a short b');
  });

  it('reports the longest usable secret', () => {
    assert.equal(maxSecretLength(['short', 'abcdefghijklm', undefined]), 13);
    assert.equal(maxSecretLength([]), 0);
  });
});
