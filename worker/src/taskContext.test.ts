import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { withContext } from './taskContext.js';

describe('withContext', () => {
  it('leaves the prompt untouched when no context was attached', () => {
    assert.equal(withContext('Fix the bug', null), 'Fix the bug');
    assert.equal(withContext('Fix the bug', undefined), 'Fix the bug');
  });

  it('treats a blank context as none', () => {
    assert.equal(withContext('Fix the bug', '  \n '), 'Fix the bug');
  });

  it('puts the fenced context before the task and labels it as background', () => {
    const prompt = withContext('Fix the bug', '  Use pnpm.\nNo default exports. ');

    assert.match(prompt, /^Background context supplied by the user/);
    assert.match(prompt, /<context>\nUse pnpm\.\nNo default exports\.\n<\/context>/);
    assert.ok(prompt.endsWith('\n\nFix the bug'));
    assert.ok(prompt.indexOf('<context>') < prompt.indexOf('Fix the bug'));
  });
});
