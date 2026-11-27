import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildSummary, compareSummaries, diffSimilarity, MIN_COMPARABLE, renderComparison, renderSummary } from './summary-lib.mjs';

describe('diffSimilarity', () => {
  const diff = (...lines) => ['diff --git a/x b/x', '--- a/x', '+++ b/x', ...lines.map((line) => `+${line}`)].join('\n');

  it('is the share of added lines the two have in common', () => {
    assert.equal(diffSimilarity(diff('const a = 1;', 'const b = 2;'), diff('const a = 1;', 'const c = 3;')), 0.333);
    assert.equal(diffSimilarity(diff('same line here'), diff('same line here')), 1);
    assert.equal(diffSimilarity(diff('one thing'), diff('another')), 0);
  });

  it('ignores indentation, the file headers and trivial lines', () => {
    assert.equal(diffSimilarity(diff('  const a = 1;'), diff('const a = 1;')), 1);
    assert.equal(diffSimilarity(diff('}', ')', 'real code here'), diff('real code here')), 1);
  });

  it('is null when there is nothing to compare', () => {
    assert.equal(diffSimilarity('', diff('x line')), null);
    assert.equal(diffSimilarity(diff('x line'), undefined), null);
  });
});

const result = (pr, over = {}) => ({ pr, failure: null, changed: ['a.ts'], missed: [], syntaxBroken: [], costUsd: 0.1, seconds: 30, ...over });

describe('buildSummary', () => {
  const summary = buildSummary({
    label: 'base',
    model: 'sonnet',
    by: 'claude',
    behaviorHash: 'h1',
    benchmarkVersion: 1,
    date: '2026-11-27',
    results: [result(1), result(2), result(3, { changed: [] }), result(4, { missed: ['b.ts'] }), result(5, { costUsd: null })],
    grades: { 1: { status: 'passed' }, 2: { status: 'failed' }, 3: { status: 'untested' }, 4: { status: 'passed' }, 5: { status: 'apply-failed' } },
    similarity: { 1: 0.8, 2: 0.2 },
    tiers: { 1: 1, 2: 2 },
  });

  it('counts the headline over the tasks that could be tested only', () => {
    assert.deepEqual([summary.totals.n, summary.totals.tested, summary.totals.passed, summary.totals.passRate], [5, 4, 2, 0.5]);
  });

  it('prices a CORRECT change, not just a run', () => {
    assert.equal(summary.totals.costUsd, 0.4);
    assert.equal(summary.totals.costPerTask, 0.1);
    assert.equal(summary.totals.costPerPass, 0.2);
  });

  it('says what a task did: plausible only if it changed something, missed nothing and parses', () => {
    assert.deepEqual(summary.tasks.map((task) => task.plausible), [true, true, false, false, true]);
    assert.equal(summary.totals.plausibleRate, 0.6);
    assert.equal(summary.totals.meanSimilarity, 0.5);
    assert.deepEqual([summary.tasks[0].tier, summary.tasks[0].tests, summary.tasks[2].tests], [1, 'passed', 'untested']);
  });

  it('has no rate for nothing, not a zero', () => {
    const empty = buildSummary({ label: 'e', model: 'm', by: 'claude', date: 'd', results: [] });

    assert.deepEqual([empty.totals.passRate, empty.totals.costPerPass, empty.totals.plausibleRate], [null, null, null]);
  });

  it('is rendered with the headline in it', () => {
    const text = renderSummary(summary);

    assert.match(text, /passed the real tests: 2 of 4 that could be tested \(50 %\)/);
    assert.match(text, /\$0\.20 per correct change/);
    assert.match(text, /\| #1 \| 1 \| passed \| 80 % \|/);
  });
});

// a summary whose tasks have the given verdicts ('p' pass, 'f' fail, '-' untested)
function summaryOf(label, verdicts, over = {}) {
  const results = [...verdicts].map((_, i) => result(i + 1));
  const grades = Object.fromEntries([...verdicts].map((verdict, i) => [i + 1, { status: verdict === 'p' ? 'passed' : verdict === 'f' ? 'failed' : 'untested' }]));

  return buildSummary({ label, model: 'sonnet', by: 'claude', date: 'd', behaviorHash: 'h', results, grades, ...over });
}

describe('compareSummaries', () => {
  it('is a regression when tasks that passed now fail and the rate falls by a tenth', () => {
    const verdict = compareSummaries(summaryOf('a', 'pppppppppppp'), summaryOf('b', 'ppppppppfff f'.replace(' ', '')));

    assert.equal(verdict.verdict, 'regression');
    assert.deepEqual(verdict.regressions, [9, 10, 11, 12]);
    assert.equal(verdict.delta, -0.333);
  });

  it('is better when the failing ones now pass', () => {
    const verdict = compareSummaries(summaryOf('a', 'ppppffffffff'), summaryOf('b', 'pppppppppppp'));

    assert.equal(verdict.verdict, 'better');
    assert.equal(verdict.improvements.length, 8);
  });

  it('is the same within what a rerun moves: one task flipping is luck', () => {
    const verdict = compareSummaries(summaryOf('a', 'pppppppppppp'), summaryOf('b', 'pppppppppppf'));

    assert.equal(verdict.verdict, 'same');
    assert.deepEqual(verdict.regressions, [12]);
  });

  it('does not call a swap of equal size a change: two lost, two gained', () => {
    const verdict = compareSummaries(summaryOf('a', 'ppppppppppff'), summaryOf('b', 'ppppppppffpp'));

    assert.equal(verdict.verdict, 'same');
  });

  it(`says nothing with fewer than ${MIN_COMPARABLE} tasks both have a verdict on`, () => {
    const verdict = compareSummaries(summaryOf('a', 'pppppp'), summaryOf('b', 'ffffff'));

    assert.equal(verdict.verdict, 'inconclusive');
    assert.match(verdict.reasons[0], /only 6 tasks/);
  });

  it('compares only the tasks both runs have a verdict on', () => {
    const verdict = compareSummaries(summaryOf('a', 'pppppppppp--'), summaryOf('b', 'pppppppppppp'));

    assert.equal(verdict.common, 10);
  });

  it('reads a task one run did not do as no verdict, not a failure', () => {
    const verdict = compareSummaries(summaryOf('a', 'pppppppppppp'), summaryOf('b', 'pppppppppp'));

    assert.equal(verdict.common, 10);
    assert.deepEqual(verdict.regressions, []);
  });

  it('says when a correct change costs more, or less', () => {
    const base = summaryOf('a', 'pppppppppppp');
    const dear = summaryOf('b', 'pppppppppppp', { results: [...Array(12)].map((_, i) => result(i + 1, { costUsd: 0.3 })) });
    const cheap = summaryOf('c', 'pppppppppppp', { results: [...Array(12)].map((_, i) => result(i + 1, { costUsd: 0.05 })) });

    assert.match(compareSummaries(base, dear).reasons.join(), /costs 3× what it did/);
    assert.match(compareSummaries(base, cheap).reasons.join(), /costs 0\.5× what it did/);
  });

  it('says a rerun is a rerun: same behaviour, same model', () => {
    assert.match(compareSummaries(summaryOf('a', 'pppppppppppp'), summaryOf('b', 'pppppppppppf')).reasons.join(), /this is a rerun, the difference is noise/);
    assert.doesNotMatch(compareSummaries(summaryOf('a', 'pppppppppppp'), summaryOf('b', 'pppppppppppf', { behaviorHash: 'other' })).reasons.join(), /this is a rerun/);
  });

  it('is rendered with the verdict first, and what was lost and gained', () => {
    const base = summaryOf('baseline', 'pppppppppppp');
    const cand = summaryOf('new prompt', 'ppppppppffff');
    const text = renderComparison(base, cand, compareSummaries(base, cand));

    assert.match(text, /^# new prompt against baseline: 🔴 REGRESSION/);
    assert.match(text, /Lost \(passed before, fail now\): #9, #10, #11, #12/);
    assert.match(text, /Gained: none/);
  });
});
