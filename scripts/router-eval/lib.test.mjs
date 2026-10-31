import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { areaOf, classifierPrompt, compare, heuristicClassify, parseClassification, policies, renderReport, truthOf } from './lib.mjs';

const f = (path, additions = 10, deletions = 0) => ({ path, additions, deletions });

describe('areaOf', () => {
  it('names the package a file belongs to', () => {
    assert.equal(areaOf('bridge/apps/backend/src/a.ts'), 'bridge/apps/backend');
    assert.equal(areaOf('bridge/apps/frontend/src/a.tsx'), 'bridge/apps/frontend');
    assert.equal(areaOf('packages/protocol/src/a.ts'), 'packages/protocol');
    assert.equal(areaOf('worker/src/a.ts'), 'worker');
    assert.equal(areaOf('docs/a.md'), 'docs');
  });
});

describe('truthOf', () => {
  it('a small change in one or two files is tier 1; a few files in one area, tier 2', () => {
    assert.equal(truthOf([f('worker/src/a.ts', 20, 5)]).tier, 1);
    assert.equal(truthOf([f('worker/src/a.ts', 30), f('worker/src/a.test.ts', 30)]).tier, 1);
    assert.equal(truthOf([f('worker/src/a.ts', 80), f('worker/src/b.ts', 40), f('worker/src/c.ts', 40)]).tier, 2);
  });

  it('a doc edit of up to three files stays tier 1 however long', () => {
    assert.equal(truthOf([f('docs/a.md', 300), f('docs/b.md', 200), f('README.md', 100)]).tier, 1);
  });

  it('two areas or a dozen files is tier 3; more than that, tier 4', () => {
    assert.equal(truthOf([f('worker/src/a.ts', 80), f('bridge/apps/backend/src/a.ts', 80), f('worker/src/b.ts', 20)]).tier, 3);
    assert.equal(truthOf(Array.from({ length: 13 }, (_, i) => f(`worker/src/${i}.ts`, 10))).tier, 4);
  });

  it('generated files do not make a task bigger, but they stop a no-shell model', () => {
    const truth = truthOf([f('bridge/apps/backend/src/a.ts', 20), f('bridge/apps/backend/openapi.json', 4000), f('package-lock.json', 9000)]);

    assert.equal(truth.tier, 1);
    assert.equal(truth.generated, true);
    assert.equal(truth.localOk, false);
  });

  it('a migration or three areas adds a tier, and never past 4', () => {
    assert.equal(truthOf([f('bridge/apps/backend/src/migrations/1-a.ts', 20)]).tier, 2);
    assert.equal(truthOf([f('worker/a.ts'), f('bridge/apps/backend/src/a.ts'), f('packages/protocol/src/a.ts')]).tier, 4);
    assert.equal(truthOf(Array.from({ length: 20 }, (_, i) => f(`worker/${i}.ts`, 100))).tier, 4);
  });

  it('can a no-shell model do it: small, nothing generated, no migration', () => {
    assert.equal(truthOf([f('worker/src/a.ts')]).localOk, true);
    assert.equal(truthOf([f('worker/src/a.ts'), f('bridge/apps/backend/src/migrations/1.ts')]).localOk, false);
    assert.equal(truthOf([f('worker/a.ts', 60), f('worker/b.ts', 60), f('worker/c.ts', 60)]).localOk, true);
    assert.equal(truthOf(Array.from({ length: 8 }, (_, i) => f(`worker/${i}.ts`, 60))).localOk, false);
  });
});

describe('heuristicClassify', () => {
  it('a short task naming one file is small; one mentioning a schema, many files and a refactor is big', () => {
    assert.equal(heuristicClassify({ title: 'Fix typo', body: 'In worker/src/a.ts the log says "teh".' }).tier, 1);

    const big = heuristicClassify({
      title: 'Refactor',
      body: 'Refactor the module: a.ts b.ts c.ts d.ts e.ts f.ts and add a migration and change the openapi schema across every endpoint. '.repeat(3),
    });

    assert.ok(big.tier >= 3);
    assert.equal(big.needsGenerated, true);
    assert.equal(heuristicClassify({ title: 'Fix typo', body: 'In worker/src/a.ts the log says "teh".' }).needsGenerated, false);
  });
});

describe('parseClassification', () => {
  it('takes the JSON out of a chatty answer, and refuses anything unusable', () => {
    assert.deepEqual(parseClassification('Sure: {"tier": 2, "needsGenerated": false}'), { tier: 2, needsGenerated: false });
    assert.deepEqual(parseClassification('```json\n{"tier":"3","needsGenerated":true}\n```'), { tier: 3, needsGenerated: true });

    for (const text of ['', 'no json', '{"tier": 7}', '{"tier": 0}', '{"tier": 1.5}', '{bad', null, undefined]) {
      assert.equal(parseClassification(text), null, String(text));
    }
  });
});

describe('compare / renderReport', () => {
  const row = (truthTier, predictedTier, extra = {}) => ({
    truth: { tier: truthTier, localOk: truthTier <= 2, ...extra },
    predicted: { tier: predictedTier, needsGenerated: false },
  });

  it('counts exact, within one, under/over and what went to a local model', () => {
    const result = compare([row(1, 1), row(2, 1), row(3, 1), row(4, 2), row(2, 4)]);

    assert.equal(result.n, 5);
    assert.equal(result.exact, 1);
    assert.equal(result.withinOne, 2);
    assert.equal(result.under, 3);
    assert.equal(result.over, 1);
    assert.equal(result.routedLocal, 4);
    assert.equal(result.unsafeLocal, 2);
    assert.equal(result.localPossible, 3);
    assert.equal(result.localFound, 2);
    assert.deepEqual(result.matrix[2], [1, 0, 0, 0]);
  });

  it('a task predicted small that needs something generated is not sent local', () => {
    const result = compare([{ truth: { tier: 1, localOk: true }, predicted: { tier: 1, needsGenerated: true } }]);

    assert.equal(result.routedLocal, 0);
  });

  it('renders without dividing by zero', () => {
    assert.match(renderReport('empty', compare([])), /empty {2}\(0 tasks\)/);
  });
});

describe('classifierPrompt', () => {
  it('carries the task and asks for one line of JSON, and cuts a huge body', () => {
    const prompt = classifierPrompt({ title: 'T', body: 'x'.repeat(10_000) });

    assert.match(prompt, /TASK TITLE: T/);
    assert.match(prompt, /one line of JSON/);
    assert.ok(prompt.length < 6000);
  });
});

describe('policies', () => {
  const row = (truth, predictedTier, needsGenerated = false) => ({ truth, predicted: { tier: predictedTier, needsGenerated } });
  const ok = { tier: 1, localOk: true, generated: false, migration: false };
  const bigger = { tier: 3, localOk: false, generated: false, migration: false };
  const hard = { tier: 2, localOk: false, generated: true, migration: false };

  it('counts what each threshold would send local, and how much of it was too much', () => {
    const rows = [row(ok, 1), row(ok, 2), row(bigger, 2), row(hard, 2), row(bigger, 3), row(hard, 1, true)];

    assert.deepEqual(policies(rows, [1, 2, 3]), [
      { limit: 1, sent: 1, right: 1, wrong: 0, hard: 0 },
      { limit: 2, sent: 4, right: 2, wrong: 2, hard: 1 },
      { limit: 3, sent: 5, right: 2, wrong: 3, hard: 1 },
    ]);
  });

  it('is part of the rendered report when given', () => {
    assert.match(renderReport('x', { ...compare([row(ok, 1)]), policies: policies([row(ok, 1)]) }), /local when predicted tier ≤/);
  });
});
