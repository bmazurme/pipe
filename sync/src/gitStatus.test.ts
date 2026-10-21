import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { getCurrentBranch, isGitTreeClean } from './gitStatus.js';

const created: string[] = [];
const originalCeiling = process.env.GIT_CEILING_DIRECTORIES;

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function plainDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'sync-cli-gitstatus-test-'));
  created.push(dir);
  return dir;
}

function emptyRepo(): string {
  const dir = plainDir();
  git(dir, ['init', '--quiet']);
  return dir;
}

// Identity is passed per-command so the tests never depend on the
// developer's (or CI's) global git config.
function committedRepo(): string {
  const dir = emptyRepo();
  writeFileSync(path.join(dir, 'README.md'), 'placeholder');
  git(dir, ['add', '-A']);
  git(dir, [
    '-c',
    'user.name=test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-m',
    'initial',
    '--quiet',
  ]);
  return dir;
}

// Keeps a "plain directory" plain even if the system tmpdir happens to sit
// inside some git checkout: git stops looking for a repo above tmpdir.
before(() => {
  process.env.GIT_CEILING_DIRECTORIES = tmpdir();
});

after(() => {
  if (originalCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
  else process.env.GIT_CEILING_DIRECTORIES = originalCeiling;
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

describe('isGitTreeClean', () => {
  it('returns true for a committed repo with no changes', () => {
    assert.equal(isGitTreeClean(committedRepo()), true);
  });

  it('returns false when a tracked file is modified', () => {
    const dir = committedRepo();
    writeFileSync(path.join(dir, 'README.md'), 'changed');
    assert.equal(isGitTreeClean(dir), false);
  });

  it('returns false when there is an untracked file', () => {
    const dir = committedRepo();
    writeFileSync(path.join(dir, 'new.txt'), 'untracked');
    assert.equal(isGitTreeClean(dir), false);
  });

  it('returns true for a plain directory that is not a git repo (nothing to protect)', () => {
    assert.equal(isGitTreeClean(plainDir()), true);
  });
});

describe('getCurrentBranch', () => {
  it('returns the checked-out branch name', () => {
    const dir = committedRepo();
    git(dir, ['checkout', '--quiet', '-b', 'task/173-628']);
    assert.equal(getCurrentBranch(dir), 'task/173-628');
  });

  it('throws in a freshly initialised repo with no commits yet', () => {
    const dir = emptyRepo();
    assert.throws(() => getCurrentBranch(dir), /Could not determine the current git branch/);
  });

  it('throws in a plain directory that is not a git repo', () => {
    const dir = plainDir();
    assert.throws(() => getCurrentBranch(dir), /Could not determine the current git branch/);
  });
});
