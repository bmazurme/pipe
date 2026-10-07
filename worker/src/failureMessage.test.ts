import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildExitFailureMessage, MAX_FAILURE_OUTPUT_CHARS } from './failureMessage.js';

describe('buildExitFailureMessage', () => {
  it('omits the suffix when output is empty or whitespace', () => {
    assert.equal(buildExitFailureMessage(1, ''), 'Model run exited with code 1');
    assert.equal(buildExitFailureMessage(2, ' \n\t'), 'Model run exited with code 2');
  });

  it('appends short output, trimmed', () => {
    assert.equal(buildExitFailureMessage(1, 'Invalid API key\n'), 'Model run exited with code 1: Invalid API key');
  });

  it('keeps only the last chars of over-long output', () => {
    const output = `${'a'.repeat(2000)}the real error`;
    const message = buildExitFailureMessage(1, output);
    const prefix = 'Model run exited with code 1: ';
    assert.ok(message.startsWith(prefix));
    assert.ok(message.endsWith('the real error'));
    assert.ok(message.length - prefix.length <= MAX_FAILURE_OUTPUT_CHARS);
    assert.ok(!message.includes('a'.repeat(MAX_FAILURE_OUTPUT_CHARS + 1)));
  });
});
