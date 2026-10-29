import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildExitFailureMessage, describeFailure, MAX_FAILURE_OUTPUT_CHARS } from './failureMessage.js';

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

describe('describeFailure', () => {
  it('returns a plain error message unchanged', () => {
    assert.equal(describeFailure(new Error('boom')), 'boom');
    assert.equal(describeFailure('text'), 'text');
  });

  it('appends the cause of a fetch failure', () => {
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND x'), { code: 'ENOTFOUND' });
    assert.equal(
      describeFailure(new TypeError('fetch failed', { cause })),
      'fetch failed (caused by: getaddrinfo ENOTFOUND x)',
    );
  });

  it('adds the code when the message lacks it', () => {
    const cause = Object.assign(new Error('timeout'), { code: 'UND_ERR_CONNECT_TIMEOUT' });
    assert.equal(
      describeFailure(new TypeError('fetch failed', { cause })),
      'fetch failed (caused by: timeout [UND_ERR_CONNECT_TIMEOUT])',
    );
  });

  it('walks nested causes', () => {
    const inner = new Error('connect ECONNREFUSED 10.0.0.2:443');
    const mid = new Error('socket error', { cause: inner });
    assert.equal(
      describeFailure(new TypeError('fetch failed', { cause: mid })),
      'fetch failed (caused by: socket error <- connect ECONNREFUSED 10.0.0.2:443)',
    );
  });

  it('survives cycles and caps depth', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    a.cause = b;
    assert.equal(describeFailure(a), 'a (caused by: b)');
    let chain = new Error('e0');
    for (let i = 1; i < 20; i++) chain = new Error(`e${i}`, { cause: chain });
    assert.equal(describeFailure(chain).split('<-').length, 4);
  });

  it('caps the length', () => {
    const message = describeFailure(new Error('x'.repeat(5000)));
    assert.equal(message.length, MAX_FAILURE_OUTPUT_CHARS);
  });
});
