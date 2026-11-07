import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { assertSafeTaskBranch, checkoutTaskBranch, commitAll } from './gitWorktree.js';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'sync-cli-gitworktree-test-'));
  git(dir, ['init', '--quiet']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  writeFileSync(path.join(dir, 'README.md'), 'placeholder');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'initial', '--quiet']);
  return dir;
}

// Stands in for husky/lint-staged: a real pre-commit hook that only
// succeeds if node_modules/.bin's own tool is present at commit time.
function installPreCommitHookRequiringNodeModules(dir: string): void {
  const hookPath = path.join(dir, '.git', 'hooks', 'pre-commit');
  writeFileSync(
    hookPath,
    '#!/bin/sh\ntest -f node_modules/.bin/marker || { echo "marker tool not found" >&2; exit 1; }\n',
  );
  chmodSync(hookPath, 0o755);
}

function writeFakeNodeModules(dir: string): void {
  mkdirSync(path.join(dir, 'node_modules', '.bin'), { recursive: true });
  writeFileSync(path.join(dir, 'node_modules', '.bin', 'marker'), '#!/bin/sh\n');
}

describe('commitAll', () => {
  it('leaves node_modules in place (and a hook that needs it succeeds) when the repo already gitignores it', () => {
    const dir = initRepo();
    writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-m', 'add gitignore', '--quiet']);

    writeFakeNodeModules(dir);
    installPreCommitHookRequiringNodeModules(dir);

    // Would throw (execFileSync rejects on the hook's nonzero exit) if
    // node_modules got stripped before the hook ran.
    assert.doesNotThrow(() => commitAll(dir, 'test commit'));
    assert.equal(existsSync(path.join(dir, 'node_modules', '.bin', 'marker')), true);
  });

  it('still strips node_modules when the repo has no .gitignore entry for it', () => {
    const dir = initRepo();
    writeFakeNodeModules(dir);

    commitAll(dir, 'test commit');

    assert.equal(existsSync(path.join(dir, 'node_modules')), false);
  });

  it('strips dist/build/coverage the same way, only when not already gitignored', () => {
    const dir = initRepo();
    writeFileSync(path.join(dir, '.gitignore'), 'dist\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-m', 'add gitignore', '--quiet']);

    mkdirSync(path.join(dir, 'dist'), { recursive: true });
    writeFileSync(path.join(dir, 'dist', 'out.js'), '');
    mkdirSync(path.join(dir, 'coverage'), { recursive: true });
    writeFileSync(path.join(dir, 'coverage', 'index.html'), '');

    commitAll(dir, 'test commit');

    assert.equal(existsSync(path.join(dir, 'dist')), true, 'dist is gitignored, should survive');
    assert.equal(existsSync(path.join(dir, 'coverage')), false, 'coverage is not gitignored, should be stripped');
  });
});

describe('assertSafeTaskBranch', () => {
  for (const branch of ['main', 'master', 'HEAD', 'develop', '-x', 'a..b', 'refs/heads/main', '', 'a b', 'a\nb', 'x@{1}', 'a//b', 'x.lock', '.hidden']) {
    it(`refuses ${JSON.stringify(branch)}`, () => {
      assert.throws(() => assertSafeTaskBranch(branch, 'develop'), /refusing branch/);
    });
  }

  for (const branch of ['task/12-3', 'feature/x']) {
    it(`accepts ${JSON.stringify(branch)}`, () => {
      assert.doesNotThrow(() => assertSafeTaskBranch(branch, 'develop'));
    });
  }
});

describe('checkoutTaskBranch', () => {
  function out(cwd: string, args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
  }

  function currentBranch(dir: string): string {
    return out(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  }

  // A bare "origin" plus a clone of it, so fetch/merge have something real to talk to.
  function cloneWithOrigin(): { origin: string; clone: string } {
    const seed = initRepo();
    git(seed, ['branch', '-M', 'main']);
    const origin = mkdtempSync(path.join(tmpdir(), 'sync-cli-gitworktree-origin-'));
    git(origin, ['clone', '--quiet', '--bare', seed, '.']);
    const clone = mkdtempSync(path.join(tmpdir(), 'sync-cli-gitworktree-clone-'));
    git(clone, ['clone', '--quiet', origin, '.']);
    git(clone, ['config', 'user.email', 'test@example.com']);
    git(clone, ['config', 'user.name', 'Test']);
    return { origin, clone };
  }

  it('creates the branch from HEAD when origin has no such branch', () => {
    const dir = initRepo();
    git(dir, ['branch', '-M', 'main']);
    const head = out(dir, ['rev-parse', 'HEAD']);

    checkoutTaskBranch(dir, 'task/1-2', 'main');

    assert.equal(currentBranch(dir), 'task/1-2');
    assert.equal(out(dir, ['rev-parse', 'HEAD']), head);
  });

  it('reuses an existing local branch instead of recreating it', () => {
    const dir = initRepo();
    git(dir, ['branch', '-M', 'main']);
    git(dir, ['checkout', '--quiet', '-b', 'task/1-2']);
    writeFileSync(path.join(dir, 'task.txt'), 'x');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-m', 'task work', '--quiet']);
    const taskHead = out(dir, ['rev-parse', 'HEAD']);
    git(dir, ['checkout', '--quiet', 'main']);

    checkoutTaskBranch(dir, 'task/1-2', 'main');

    assert.equal(currentBranch(dir), 'task/1-2');
    assert.equal(out(dir, ['rev-parse', 'HEAD']), taskHead);
  });

  it('tracks origin/<branch> when only the remote has it', () => {
    const { clone } = cloneWithOrigin();
    const other = mkdtempSync(path.join(tmpdir(), 'sync-cli-gitworktree-other-'));
    git(other, ['clone', '--quiet', out(clone, ['remote', 'get-url', 'origin']), '.']);
    git(other, ['config', 'user.email', 'test@example.com']);
    git(other, ['config', 'user.name', 'Test']);
    git(other, ['checkout', '--quiet', '-b', 'task/1-2']);
    writeFileSync(path.join(other, 'agent.txt'), 'from agent');
    git(other, ['add', '-A']);
    git(other, ['commit', '-m', 'agent', '--quiet']);
    git(other, ['push', '--quiet', 'origin', 'task/1-2']);

    checkoutTaskBranch(clone, 'task/1-2', 'main');

    assert.equal(currentBranch(clone), 'task/1-2');
    assert.equal(out(clone, ['rev-parse', 'HEAD']), out(other, ['rev-parse', 'HEAD']));
    assert.equal(out(clone, ['rev-parse', '--abbrev-ref', '@{upstream}']), 'origin/task/1-2');
  });

  it('fast-forwards an existing local branch that is behind origin', () => {
    const { clone } = cloneWithOrigin();
    git(clone, ['checkout', '--quiet', '-b', 'task/1-2']);
    git(clone, ['push', '--quiet', '-u', 'origin', 'task/1-2']);
    git(clone, ['checkout', '--quiet', 'main']);

    const other = mkdtempSync(path.join(tmpdir(), 'sync-cli-gitworktree-other-'));
    git(other, ['clone', '--quiet', '--branch', 'task/1-2', out(clone, ['remote', 'get-url', 'origin']), '.']);
    git(other, ['config', 'user.email', 'test@example.com']);
    git(other, ['config', 'user.name', 'Test']);
    writeFileSync(path.join(other, 'agent.txt'), 'from agent');
    git(other, ['add', '-A']);
    git(other, ['commit', '-m', 'agent', '--quiet']);
    git(other, ['push', '--quiet', 'origin', 'task/1-2']);

    checkoutTaskBranch(clone, 'task/1-2', 'main');

    assert.equal(currentBranch(clone), 'task/1-2');
    assert.equal(out(clone, ['rev-parse', 'HEAD']), out(other, ['rev-parse', 'HEAD']));
  });

  for (const branch of ['main', 'develop', 'a..b']) {
    it(`refuses ${JSON.stringify(branch)} and leaves HEAD where it was`, () => {
      const dir = initRepo();
      git(dir, ['branch', '-M', 'main']);

      assert.throws(() => checkoutTaskBranch(dir, branch, 'develop'), /refusing branch/);

      assert.equal(currentBranch(dir), 'main');
    });
  }
});
