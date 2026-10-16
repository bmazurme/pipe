import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createProgressReporter, renderProgress } from './progress.js';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('renderProgress', () => {
  it('is just the answer so far when the model showed no reasoning', () => {
    assert.equal(renderProgress('', 'Hello'), 'Hello');
  });

  it('quotes the reasoning above the answer', () => {
    assert.equal(renderProgress('first\nsecond', 'Answer'), '> 💭 first\n> second\n\nAnswer');
  });

  it('keeps only the tail of a long reasoning', () => {
    const text = renderProgress('x'.repeat(5000) + 'END', '');

    assert.ok(text.length < 1600);
    assert.ok(text.endsWith('END'));
  });
});

describe('createProgressReporter', () => {
  it('sends the first words at once, then at most one report per interval, always the whole text so far', async () => {
    const sent: string[] = [];
    const reporter = createProgressReporter((text) => void sent.push(text), 60);

    reporter.push({ kind: 'text', text: 'Hel' });
    await wait(15);
    assert.deepEqual(sent, ['Hel']);

    reporter.push({ kind: 'text', text: 'lo ' });
    reporter.push({ kind: 'text', text: 'world' });
    await wait(15);
    assert.deepEqual(sent, ['Hel'], 'not again before the interval');

    await wait(80);
    assert.deepEqual(sent, ['Hel', 'Hello world']);
    reporter.stop();
  });

  it('does not repeat an identical report', async () => {
    const sent: string[] = [];
    const reporter = createProgressReporter((text) => void sent.push(text), 20);

    reporter.push({ kind: 'text', text: 'same' });
    await wait(60);
    reporter.push({ kind: 'text', text: '' });
    await wait(60);

    assert.deepEqual(sent, ['same']);
    reporter.stop();
  });

  it('drops a pending report once stopped, and ignores later deltas', async () => {
    const sent: string[] = [];
    const reporter = createProgressReporter((text) => void sent.push(text), 30);

    reporter.push({ kind: 'text', text: 'a' });
    await wait(10);
    reporter.push({ kind: 'text', text: 'b' });
    reporter.stop();
    reporter.push({ kind: 'text', text: 'c' });
    await wait(80);

    assert.deepEqual(sent, ['a']);
  });

  it('never lets a failing send reach the run', async () => {
    const reporter = createProgressReporter(() => Promise.reject(new Error('bridge down')), 10);

    reporter.push({ kind: 'text', text: 'x' });
    await wait(40);
    reporter.stop();
  });

  it('shows the reasoning the model gives, then the answer', async () => {
    const sent: string[] = [];
    const reporter = createProgressReporter((text) => void sent.push(text), 20);

    reporter.push({ kind: 'thinking', text: 'Let me check' });
    await wait(10);
    reporter.push({ kind: 'text', text: 'It is 391.' });
    await wait(60);

    assert.equal(sent.at(-1), '> 💭 Let me check\n\nIt is 391.');
    reporter.stop();
  });
});
