import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_MIX, freezeBenchmark, freezeTask, isTestable, selectBenchmark, spread, validateBenchmark } from './benchmark-lib.mjs';

const file = (path) => ({ path, additions: 10, deletions: 2 });
const task = (pr, tier, paths, over = {}) => ({
  pr,
  issue: pr - 1,
  title: `Task ${pr}`,
  body: `Body of ${pr}`,
  mergeCommit: `m${pr}`,
  files: paths.map(file),
  truth: { tier, files: paths.length, lines: 12, areas: ['x'], migration: false, generated: false, localOk: tier <= 2 },
  ...over,
});
const code = (n) => [`bridge/apps/backend/src/a${n}.ts`, `bridge/apps/backend/src/a${n}.spec.ts`];

describe('isTestable', () => {
  it('needs a test the grader can run and code beyond the tests', () => {
    assert.equal(isTestable(task(1, 1, code(1))), true);
    assert.equal(isTestable(task(1, 1, ['bridge/apps/backend/src/a.ts'])), false, 'no test came with it');
    assert.equal(isTestable(task(1, 1, ['bridge/apps/backend/src/a.spec.ts'])), false, 'only tests: judged by the model\'s own tests, which says little');
    assert.equal(isTestable(task(1, 1, ['docs/a.md', 'reports/packages/server/src/a.test.ts'])), false, 'a test the grader has no way to run');
  });
});

describe('spread', () => {
  it('takes evenly from the whole range, the same every time', () => {
    const items = Array.from({ length: 20 }, (_, i) => i);

    assert.deepEqual(spread(items, 4), [2, 7, 12, 17]);
    assert.deepEqual(spread(items, 4), spread(items, 4));
  });

  it('gives everything when asked for more than there is, nothing for nothing', () => {
    assert.deepEqual(spread([1, 2], 5), [1, 2]);
    assert.deepEqual(spread([1, 2], 0), []);
  });
});

describe('selectBenchmark', () => {
  const all = [
    ...Array.from({ length: 30 }, (_, i) => task(100 + i, 1, code(i))),
    ...Array.from({ length: 30 }, (_, i) => task(200 + i, 2, code(i))),
    ...Array.from({ length: 30 }, (_, i) => task(300 + i, 3, code(i))),
    ...Array.from({ length: 30 }, (_, i) => task(400 + i, 4, code(i))),
  ];

  it('takes the mix asked for, no tier 4, ordered by pull request', () => {
    const picked = selectBenchmark(all);
    const count = (tier) => picked.filter((entry) => entry.truth.tier === tier).length;

    assert.deepEqual([count(1), count(2), count(3), count(4)], [DEFAULT_MIX[1], DEFAULT_MIX[2], DEFAULT_MIX[3], 0]);
    assert.deepEqual(picked.map((entry) => entry.pr), picked.map((entry) => entry.pr).sort((a, b) => a - b));
  });

  it('is the same pick however the input is ordered', () => {
    const shuffled = [...all].reverse();

    assert.deepEqual(selectBenchmark(shuffled).map((entry) => entry.pr), selectBenchmark(all).map((entry) => entry.pr));
  });

  it('covers the whole period of a tier, not its newest corner', () => {
    const tier1 = selectBenchmark(all).filter((entry) => entry.truth.tier === 1).map((entry) => entry.pr);

    assert.ok(tier1[0] < 105 && tier1.at(-1) > 124);
  });

  it('skips what cannot be graded or run: untestable, no merge commit, no text', () => {
    const picked = selectBenchmark([task(1, 1, ['a.md']), task(2, 1, code(2), { mergeCommit: null }), task(3, 1, code(3), { body: '  ' }), task(4, 1, code(4))], { 1: 5 });

    assert.deepEqual(picked.map((entry) => entry.pr), [4]);
  });

  it('gives what a thin tier has', () => {
    assert.equal(selectBenchmark([task(1, 3, code(1)), task(2, 3, code(2))], { 3: 10 }).length, 2);
  });
});

describe('freezing', () => {
  it('keeps only what a run and the grader need', () => {
    const frozen = freezeTask({ ...task(7, 2, code(7)), author: 'someone', comments: ['x'], labels: ['loop'] });

    assert.deepEqual(Object.keys(frozen).sort(), ['body', 'files', 'issue', 'mergeCommit', 'pr', 'title', 'truth']);
  });

  it('makes a manifest that says what it is made of, and that is valid', () => {
    const manifest = freezeBenchmark(
      [...Array.from({ length: 10 }, (_, i) => task(10 + i, 1, code(i))), ...Array.from({ length: 5 }, (_, i) => task(50 + i, 2, code(i)))],
      { repo: 'o/r', createdAt: '2026-11-27', mix: { 1: 3, 2: 2 } },
    );

    assert.equal(manifest.version, 1);
    assert.deepEqual(manifest.tiers, { 1: 3, 2: 2, 3: 0, 4: 0 });
    assert.equal(manifest.tasks.length, 5);
    assert.deepEqual(validateBenchmark(manifest), []);
  });
});

describe('validateBenchmark', () => {
  it('refuses what it should not run', () => {
    assert.deepEqual(validateBenchmark(null), ['not an object']);
    assert.match(validateBenchmark({ version: 9, tasks: [] }).join(), /version 9/);
    assert.match(validateBenchmark({ version: 1, tasks: [] }).join(), /no tasks/);
    assert.match(validateBenchmark({ version: 1, tasks: [{ pr: 1 }] }).join(), /task 1 is incomplete/);

    const one = freezeTask(task(5, 1, code(5)));

    assert.match(validateBenchmark({ version: 1, tasks: [one, one] }).join(), /task 5 twice/);
  });
});
