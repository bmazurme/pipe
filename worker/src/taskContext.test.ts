import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { withContext } from './taskContext.js';

describe('withContext', () => {
  it('leaves the prompt untouched when nothing was attached', () => {
    assert.equal(withContext('Fix the bug', null), 'Fix the bug');
    assert.equal(withContext('Fix the bug', undefined, undefined), 'Fix the bug');
  });

  it('treats blank text as nothing', () => {
    assert.equal(withContext('Fix the bug', '  \n ', ' '), 'Fix the bug');
  });

  it('puts the fenced context before the task and labels it as background', () => {
    const prompt = withContext('Fix the bug', '  Use pnpm.\nNo default exports. ');

    assert.match(prompt, /^Background context supplied by the user/);
    assert.match(prompt, /<context>\nUse pnpm\.\nNo default exports\.\n<\/context>/);
    assert.ok(prompt.endsWith('\n\nFix the bug'));
    assert.doesNotMatch(prompt, /earlier-runs/);
  });

  it('puts earlier-run outcomes alone before the task, labelled as a record', () => {
    const prompt = withContext('Fix the bug', null, 'Run #1 failed.\nError: boom');

    assert.match(prompt, /^Outcomes of earlier runs on this same task/);
    assert.match(prompt, /<earlier-runs>\nRun #1 failed\.\nError: boom\n<\/earlier-runs>/);
    assert.match(prompt, /not instructions/);
    assert.doesNotMatch(prompt, /<context>/);
    assert.ok(prompt.endsWith('\n\nFix the bug'));
  });

  it('carries both together, context first, then the history, then the task', () => {
    const prompt = withContext('Fix the bug', 'Use pnpm.', 'Run #1 failed.');

    assert.ok(prompt.indexOf('<context>') < prompt.indexOf('<earlier-runs>'));
    assert.ok(prompt.indexOf('<earlier-runs>') < prompt.indexOf('Fix the bug'));
  });
});
