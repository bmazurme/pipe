import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { filesInDiff, isTestFile, linkNodeModules, renderGrades, testCommand, testsToRun } from './grade-lib.mjs';

describe('isTestFile', () => {
  it('knows spec and test files of every flavour, and nothing else', () => {
    for (const path of ['a/b.spec.ts', 'a/b.test.tsx', 'x.test.mjs', 'worker/src/credentials.test.ts']) assert.equal(isTestFile(path), true, path);
    for (const path of ['a/spec.ts', 'a/test.md', 'a/b.specs.ts', 'docs/auth.md']) assert.equal(isTestFile(path), false, path);
  });
});

describe('testCommand', () => {
  it('runs backend specs with jest from the app, frontend ones with vitest', () => {
    assert.deepEqual(testCommand('bridge/apps/backend/src/inbox/inbox.service.spec.ts'), {
      cwd: 'bridge/apps/backend',
      steps: [['npx', 'jest', '--silent', 'src/inbox/inbox.service.spec.ts']],
    });
    assert.deepEqual(testCommand('bridge/apps/frontend/src/a.test.tsx'), { cwd: 'bridge/apps/frontend', steps: [['npx', 'vitest', 'run', 'src/a.test.tsx']] });
  });

  it('builds a Node-runner package first, then runs the compiled test', () => {
    assert.deepEqual(testCommand('harness/src/events.test.ts'), { cwd: 'harness', steps: [['npx', 'tsc', '-b'], ['node', '--test', 'dist/events.test.js']] });
    assert.deepEqual(testCommand('packages/protocol/src/x/y.test.ts').steps.at(-1), ['node', '--test', 'dist/x/y.test.js']);
  });

  it('has no way for what it does not know', () => {
    assert.equal(testCommand('docs/a.md'), null);
    assert.equal(testCommand('reports/packages/server/src/a.test.ts'), null);
  });
});

describe('testsToRun', () => {
  it('lays the real pull request\'s tests over the model\'s work and runs them', () => {
    assert.deepEqual(testsToRun(['a/x.ts', 'a/x.spec.ts'], ['a/x.ts']), { files: ['a/x.spec.ts'], overlay: ['a/x.spec.ts'] });
  });

  it('for a pull request that is only tests, runs the model\'s own test files and lays nothing over', () => {
    assert.deepEqual(testsToRun(['a/x.spec.ts'], ['a/x.spec.ts', 'a/other.ts']), { files: ['a/x.spec.ts'], overlay: [] });
    assert.deepEqual(testsToRun(['a/x.spec.ts'], ['a/notest.ts']), { files: [], overlay: [] });
  });

  it('has nothing to run for a change with no test at all (docs)', () => {
    assert.deepEqual(testsToRun(['docs/auth.md'], ['docs/auth.md']), { files: [], overlay: [] });
  });
});

describe('filesInDiff', () => {
  it('lists the files a diff touches, the new name of a rename, and nothing for an empty diff', () => {
    const diff = 'diff --git a/x.ts b/x.ts\nindex 1..2\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b\ndiff --git a/old.ts b/new.ts\nsimilarity index 90%\n';

    assert.deepEqual(filesInDiff(diff), ['x.ts', 'new.ts']);
    assert.deepEqual(filesInDiff(''), []);
  });
});

describe('linkNodeModules', () => {
  it('links the node_modules of the source project into a checkout, where the folder exists', () => {
    const source = mkdtempSync(join(tmpdir(), 'src-'));
    const target = mkdtempSync(join(tmpdir(), 'dst-'));

    mkdirSync(join(source, 'node_modules'));
    mkdirSync(join(source, 'app', 'node_modules'), { recursive: true });
    mkdirSync(join(source, 'gone', 'node_modules'), { recursive: true });
    mkdirSync(join(source, 'node_modules', 'pkg', 'node_modules'), { recursive: true });
    mkdirSync(join(target, 'app'));
    writeFileSync(join(source, 'a.txt'), '');

    const found = linkNodeModules(source, target);

    assert.deepEqual(found.sort(), ['app/node_modules', 'gone/node_modules', 'node_modules']);
    assert.equal(readlinkSync(join(target, 'node_modules')), join(source, 'node_modules'));
    assert.equal(readlinkSync(join(target, 'app', 'node_modules')), join(source, 'app', 'node_modules'));
    assert.throws(() => readlinkSync(join(target, 'gone', 'node_modules')), 'the parent folder does not exist in the checkout');

    rmSync(source, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  });
});

describe('renderGrades', () => {
  const row = (pr, status, ran = [], output = '') => ({ pr, grade: { status, ran, output } });

  it('counts passes among what could be tested, and gives a row to each task', () => {
    const text = renderGrades('qwen3', [
      row(1, 'passed', [{ path: 'a/x.spec.ts', ok: true }]),
      row(2, 'failed', [{ path: 'a/y.spec.ts', ok: false }], 'line one\nExpected 1 got 2'),
      row(3, 'apply-failed', [], 'patch does not apply'),
      row(4, 'untested', [], 'no test'),
    ]);

    assert.match(text, /passed the real tests: 1 of 2 that could be tested\*\*; failed: 1; the diff did not apply: 1; not testable[^:]*: 1/);
    assert.match(text, /\| #2 \| failed \| ✗ y\.spec\.ts \| Expected 1 got 2 \|/);
    assert.match(text, /\| #1 \| passed \| ✓ x\.spec\.ts \| {2}\|/);
  });

  it('renders an empty run', () => {
    assert.match(renderGrades('x', []), /0 of 0 that could be tested/);
  });
});
