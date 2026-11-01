import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createRequire } from 'node:module';

import { buildPrompt, compareFiles, pathsOf, renderReplay, replayTask, selectTasks, summarize, syntaxErrors } from './replay-lib.mjs';

const ts = createRequire(import.meta.url)('typescript');
const sh = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

describe('selectTasks', () => {
  const task = (pr, tier, localOk = true) => ({ pr, truth: { tier, localOk } });

  it('takes the small, file-only tasks, newest first, up to the limit', () => {
    const picked = selectTasks([task(1, 1), task(5, 1), task(3, 2), task(9, 1, false), task(7, 1)], { maxTier: 1, limit: 2 });

    assert.deepEqual(picked.map((t) => t.pr), [7, 5]);
    assert.deepEqual(selectTasks([task(1, 1), task(2, 2)], { maxTier: 2, limit: 8 }).map((t) => t.pr), [2, 1]);
  });
});

describe('pathsOf / compareFiles / buildPrompt', () => {
  it('reads the paths out of git status, renames by their new name', () => {
    assert.deepEqual(pathsOf(' M a/b.ts\n?? new.txt\nA  c.ts\nR  old.ts -> renamed.ts\n D gone.ts\n'), ['a/b.ts', 'new.txt', 'c.ts', 'renamed.ts', 'gone.ts']);
    assert.deepEqual(pathsOf(''), []);
  });

  it('says which of the real change\'s files the model touched, missed, and what it touched besides', () => {
    assert.deepEqual(compareFiles(['a', 'b', 'x'], ['a', 'b', 'c']), { same: ['a', 'b'], missed: ['c'], extra: ['x'] });
  });

  it('hands over the task like the worker does, through the worker\'s own wrapper when given', () => {
    assert.equal(buildPrompt({ title: 'T', body: 'B' }), 'Task (GitLab issue): T\n\nB');
    assert.equal(buildPrompt({ title: 'T', body: 'B' }, (text) => `${text}\n!`), 'Task (GitLab issue): T\n\nB\n!');
  });
});

describe('syntaxErrors', () => {
  let dir;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'syntax-'));
    writeFileSync(join(dir, 'ok.ts'), 'export const a: number = 1;\n');
    writeFileSync(join(dir, 'ok.tsx'), 'export const B = () => <div>hi</div>;\n');
    writeFileSync(join(dir, 'broken.ts'), 'export const a = ;\nfunction (\n');
    writeFileSync(join(dir, 'notes.md'), 'export const a = ;');
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  it('flags a file that no longer parses and leaves valid code, JSX, docs and missing files alone', () => {
    assert.deepEqual(syntaxErrors(dir, ['ok.ts', 'ok.tsx', 'broken.ts', 'notes.md', 'deleted.ts'], ts), ['broken.ts']);
  });
});

describe('replayTask', () => {
  let repo;
  let work;
  let merge;

  before(() => {
    repo = mkdtempSync(join(tmpdir(), 'replay-repo-'));
    work = mkdtempSync(join(tmpdir(), 'replay-work-'));
    sh(repo, 'init', '-q', '-b', 'main');
    sh(repo, 'config', 'user.email', 't@t');
    sh(repo, 'config', 'user.name', 't');
    mkdirSync(join(repo, 'src'));
    writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(repo, 'README.md'), 'hello\n');
    sh(repo, 'add', '-A');
    sh(repo, 'commit', '-q', '-m', 'base');
    writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 2;\n');
    sh(repo, 'commit', '-q', '-am', 'the merged change');
    merge = sh(repo, 'rev-parse', 'HEAD');
  });

  after(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  });

  const task = () => ({ pr: 42, title: 'Set a to 2', body: 'In src/a.ts', mergeCommit: merge, files: [{ path: 'src/a.ts' }] });

  it('runs the model on the project as it was before the change, and measures what it did', async () => {
    let seenBefore = '';
    let prompt = '';
    const result = await replayTask({
      repo,
      task: task(),
      workRoot: work,
      ts,
      run: async (dir, text) => {
        prompt = text;
        seenBefore = readFileSync(join(dir, 'src', 'a.ts'), 'utf8');
        writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 2;\n');
        writeFileSync(join(dir, 'notes.txt'), 'extra\n');

        return { exitCode: 0, output: 'done' };
      },
    });

    assert.equal(seenBefore, 'export const a = 1;\n', 'the model sees the project before the merged change');
    assert.match(prompt, /^Task \(GitLab issue\): Set a to 2/);
    assert.deepEqual(result.changed.sort(), ['notes.txt', 'src/a.ts']);
    assert.deepEqual([result.same, result.missed, result.extra], [['src/a.ts'], [], ['notes.txt']]);
    assert.deepEqual(result.syntaxBroken, []);
    assert.match(result.diff, /\+export const a = 2;/);
    assert.equal(result.failure, null);
    assert.equal(sh(repo, 'worktree', 'list').split('\n').length, 1, 'the checkout is removed again');
    assert.equal(sh(repo, 'status', '--porcelain'), '', 'the project itself is untouched');
  });

  it('does not count the node_modules links a test run needs as the model\'s work, and reports the run\'s cost', async () => {
    const modules = mkdtempSync(join(tmpdir(), 'replay-modules-'));
    const result = await replayTask({
      repo,
      task: task(),
      workRoot: work,
      ts,
      run: async (dir) => {
        symlinkSync(modules, join(dir, 'node_modules'));
        mkdirSync(join(dir, 'src', 'deep'), { recursive: true });
        symlinkSync(modules, join(dir, 'src', 'deep', 'node_modules'));
        writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 2;\n');

        return { exitCode: 0, output: '', report: { usage: { costUsd: 0.0123, turns: 4 } } };
      },
    });

    assert.deepEqual(result.changed, ['src/a.ts']);
    assert.ok(!result.diff.includes('node_modules'));
    assert.deepEqual([result.costUsd, result.turns], [0.0123, 4]);
    rmSync(modules, { recursive: true, force: true });
  });

  it('records a run that changed nothing, one that broke a file, and one that failed', async () => {
    const nothing = await replayTask({ repo, task: task(), workRoot: work, ts, run: async () => ({ exitCode: 0, output: 'I would change it.' }) });

    assert.deepEqual([nothing.changed, nothing.missed], [[], ['src/a.ts']]);

    const broken = await replayTask({
      repo,
      task: task(),
      workRoot: work,
      ts,
      run: async (dir) => {
        writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = ;\n');

        return { exitCode: 0, output: '' };
      },
    });

    assert.deepEqual(broken.syntaxBroken, ['src/a.ts']);

    const failed = await replayTask({ repo, task: task(), workRoot: work, ts, run: async () => { throw new Error('model down'); } });

    assert.equal(failed.failure, 'model down');
    assert.equal(sh(repo, 'worktree', 'list').split('\n').length, 1);
  });
});

describe('summarize / renderReplay', () => {
  const result = (over) => ({ pr: 1, seconds: 10, failure: null, changed: ['a'], same: ['a'], missed: [], extra: [], syntaxBroken: [], ...over });

  it('counts the plausible ones: touched everything the real change did, all files parse', () => {
    const results = [result({}), result({ pr: 2, extra: ['x'] }), result({ pr: 3, missed: ['b'] }), result({ pr: 4, changed: [], same: [], missed: ['a'] }), result({ pr: 5, syntaxBroken: ['a'] })];
    const s = summarize(results);

    assert.deepEqual([s.n, s.changedSomething, s.plausible, s.plausibleClean, s.syntaxBroken, s.seconds], [5, 4, 2, 1, 1, 50]);
  });

  it('adds up the cost when runs report one, and leaves the column empty when none does', () => {
    const text = renderReplay('haiku', [result({ costUsd: 0.05 }), result({ pr: 2, costUsd: 0.1 })]);

    assert.match(text, /cost \$0\.15 \(\$0\.075 a task\)/);
    assert.match(text, /\| #1 \| 10 \| 0\.050 \|/);
    assert.doesNotMatch(renderReplay('qwen', [result({})]), /cost \$/);
  });

  it('renders a table with a row per task, and survives an empty run', () => {
    const text = renderReplay('qwen', [result({}), result({ pr: 2, failure: 'model down', changed: [] })]);

    assert.match(text, /# Replay on qwen: 2 past tasks/);
    assert.match(text, /\| #2 \| 10 \| {2}\| 0 \| 0 \| 0 \| yes \| model down \|/);
    assert.match(renderReplay('x', []), /0 past tasks/);
  });
});
