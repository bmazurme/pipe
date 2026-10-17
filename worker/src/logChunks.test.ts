import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_LOG_CHUNK_CHARS, splitLogChunk } from './logChunks.js';

describe('splitLogChunk', () => {
  it('returns nothing for an empty string and one piece for a short one', () => {
    assert.deepEqual(splitLogChunk(''), []);
    assert.deepEqual(splitLogChunk('hello'), ['hello']);
  });

  it('splits into pieces of at most the cap that join back to the input', () => {
    const text = 'x'.repeat(MAX_LOG_CHUNK_CHARS * 3 + 7);
    const pieces = splitLogChunk(text);
    assert.equal(pieces.length, 4);
    assert.ok(pieces.every((piece) => piece.length <= MAX_LOG_CHUNK_CHARS));
    assert.equal(pieces.join(''), text);
  });

  it('never cuts a surrogate pair in half', () => {
    // 'a😀' puts the high surrogate exactly at the cut for maxChars = 2.
    const pieces = splitLogChunk('a😀b😀😀', 2);
    assert.deepEqual(pieces, ['a', '😀', 'b', '😀', '😀']);
  });
});
