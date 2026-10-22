import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extractQuestions, withQuestionsInstruction } from './taskQuestions.js';

describe('extractQuestions', () => {
  it('reads one question per line, dropping list markers and blanks', () => {
    const output = 'Done.\n\n```pipe-questions\n- Which branch?\n2. Is X ok?\n\n• Third?\n```\n';

    assert.deepEqual(extractQuestions(output), ['Which branch?', 'Is X ok?', 'Third?']);
  });

  it('takes the last block when the format was also quoted earlier', () => {
    const output = '```pipe-questions\nexample?\n```\nmore\n```pipe-questions\nreal one?\n```';

    assert.deepEqual(extractQuestions(output), ['real one?']);
  });

  it('is empty without a block, and ignores other fences', () => {
    assert.deepEqual(extractQuestions('all done'), []);
    assert.deepEqual(extractQuestions('```ts\nconst a = 1;\n```'), []);
  });

  it('removes duplicates and clips to bridge limits', () => {
    const long = 'x'.repeat(900);
    const lines = ['Same?', 'same?', long, ...Array.from({ length: 30 }, (_, i) => `q${i}`)].join('\n');
    const result = extractQuestions('```pipe-questions\n' + lines + '\n```');

    assert.equal(result.filter((q) => q.toLowerCase() === 'same?').length, 1);
    assert.equal(result[1].length, 500);
    assert.equal(result.length, 20);
  });
});

describe('withQuestionsInstruction', () => {
  it('keeps the task first and tells the model about the block', () => {
    const prompt = withQuestionsInstruction('Do the task');

    assert.ok(prompt.startsWith('Do the task'));
    assert.match(prompt, /```pipe-questions/);
  });
});
