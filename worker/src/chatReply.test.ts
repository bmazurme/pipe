import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { clipReasoning, clipReply, MAX_REASONING_LENGTH, MAX_REPLY_LENGTH, TRUNCATED_REPLY_NOTE } from './chatReply.js';

describe('clipReply', () => {
  it('leaves a reply that fits untouched', () => {
    const reply = 'x'.repeat(MAX_REPLY_LENGTH);
    assert.equal(clipReply(reply), reply);
  });

  it('cuts a longer reply to exactly the limit, ending with the note', () => {
    const clipped = clipReply('x'.repeat(MAX_REPLY_LENGTH + 10));
    assert.equal(clipped.length, MAX_REPLY_LENGTH);
    assert.ok(clipped.endsWith(TRUNCATED_REPLY_NOTE));
  });

  it('does not split a surrogate pair at the cut', () => {
    const max = TRUNCATED_REPLY_NOTE.length + 4;
    const clipped = clipReply(`abc${'😀'.repeat(max)}`, max);
    assert.equal(clipped, `abc${TRUNCATED_REPLY_NOTE}`);
  });
});

describe('clipReasoning', () => {
  it('leaves reasoning that fits untouched', () => {
    const reasoning = 'x'.repeat(MAX_REASONING_LENGTH);
    assert.equal(clipReasoning(reasoning), reasoning);
  });

  it('cuts longer reasoning silently, with no note', () => {
    const clipped = clipReasoning('x'.repeat(MAX_REASONING_LENGTH + 10));
    assert.equal(clipped.length, MAX_REASONING_LENGTH);
    assert.equal(clipped, 'x'.repeat(MAX_REASONING_LENGTH));
  });
});
