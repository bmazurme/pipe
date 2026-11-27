import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { BASELINE_FILE, BEHAVIOR_FILES, changedBehavior, checkBehavior, checkPullRequest, fingerprint } from './behavior-lib.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const reader = (files) => (path) => (path in files ? files[path] : null);

describe('the list', () => {
  it('names only files that exist (a path that moved would silently stop being watched)', () => {
    for (const path of BEHAVIOR_FILES) assert.ok(existsSync(join(REPO, path)), `${path} does not exist`);
  });

  it('has no duplicates', () => {
    assert.equal(new Set(BEHAVIOR_FILES).size, BEHAVIOR_FILES.length);
  });
});

describe('fingerprint', () => {
  const files = ['a', 'b'];

  it('is the same for the same content and changes with any file', () => {
    const one = fingerprint(reader({ a: '1', b: '2' }), files);

    assert.equal(fingerprint(reader({ a: '1', b: '2' }), files).hash, one.hash);
    assert.notEqual(fingerprint(reader({ a: '1', b: '3' }), files).hash, one.hash);
    assert.equal(one.hash.length, 16);
  });

  it('counts a file that was removed as a change (and tells it from an empty one)', () => {
    const present = fingerprint(reader({ a: '1', b: '' }), files);
    const gone = fingerprint(reader({ a: '1' }), files);

    assert.notEqual(present.hash, gone.hash);
    assert.equal(gone.files.b, null);
  });

  it('is not fooled by content moving between files', () => {
    assert.notEqual(fingerprint(reader({ a: 'x', b: 'y' }), files).hash, fingerprint(reader({ a: 'y', b: 'x' }), files).hash);
  });
});

describe('changedBehavior and checkBehavior', () => {
  const baseline = { behavior: fingerprint(reader({ a: '1', b: '2' }), ['a', 'b']) };

  it('names the files that differ', () => {
    assert.deepEqual(changedBehavior(baseline.behavior, fingerprint(reader({ a: '1', b: 'CHANGED' }), ['a', 'b'])), ['b']);
    assert.deepEqual(changedBehavior(baseline.behavior, fingerprint(reader({ a: '1', b: '2', c: 'new' }), ['a', 'b', 'c'])), ['c']);
  });

  it('is fine when nothing moved', () => {
    assert.equal(checkBehavior(baseline, fingerprint(reader({ a: '1', b: '2' }), ['a', 'b'])).ok, true);
  });

  it('says what to do when something moved', () => {
    const result = checkBehavior(baseline, fingerprint(reader({ a: 'NEW', b: '2' }), ['a', 'b']));

    assert.equal(result.ok, false);
    assert.deepEqual(result.changed, ['a']);
    assert.match(result.message, /changed since the baseline \(a\)/);
    assert.match(result.message, /run.*run\.mjs eval/);
  });

  it('says so when there is no baseline at all', () => {
    assert.equal(checkBehavior(null, fingerprint(reader({}), ['a'])).ok, false);
    assert.match(checkBehavior({}, fingerprint(reader({}), ['a'])).message, /missing or unreadable/);
  });
});

describe('checkPullRequest', () => {
  const dod = 'bridge/apps/backend/src/improve/definition-of-done.ts';

  it('has nothing to say about a pull request that does not touch what defines the assistant', () => {
    assert.equal(checkPullRequest(['docs/a.md', 'bridge/apps/frontend/src/a.tsx']).ok, true);
    assert.deepEqual(checkPullRequest([]).touched, []);
  });

  it('asks for a measurement when behaviour changes and the baseline does not', () => {
    const result = checkPullRequest([dod, 'worker/src/taskQuestions.ts', 'docs/a.md']);

    assert.equal(result.ok, false);
    assert.deepEqual(result.touched, ['bridge/apps/backend/src/improve/definition-of-done.ts', 'worker/src/taskQuestions.ts']);
    assert.match(result.message, /but not eval\/baseline\.json/);
    assert.match(result.message, /run\.mjs eval/);
  });

  it('is satisfied when the baseline moved with it', () => {
    const result = checkPullRequest([dod, BASELINE_FILE]);

    assert.equal(result.ok, true);
    assert.match(result.message, /the new behaviour was measured/);
  });

  it('does not count a change of the baseline alone as a behaviour change', () => {
    assert.equal(checkPullRequest([BASELINE_FILE]).ok, true);
  });
});

describe('the committed baseline', () => {
  it('is readable and says which files it fingerprinted', () => {
    const path = join(REPO, 'eval', 'baseline.json');

    if (!existsSync(path)) return;

    const baseline = JSON.parse(readFileSync(path, 'utf8'));

    assert.deepEqual(Object.keys(baseline.behavior.files).sort(), [...BEHAVIOR_FILES].sort());
  });
});
