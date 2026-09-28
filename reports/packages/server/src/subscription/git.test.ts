import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { buildBranchName, checkoutTaskBranch, commitPulledFiles, pushBranch } from './git';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'reports-git-test-'));
  // Explicit -b: the host's init.defaultBranch config shouldn't affect
  // whether these tests pass, and some of them specifically exercise
  // "master" by name.
  git(dir, ['init', '--quiet', '-b', 'master']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  writeFileSync(path.join(dir, 'README.md'), 'placeholder');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'initial', '--quiet']);
  return dir;
}

describe('buildBranchName', () => {
  it('builds the username-date-iid mask', () => {
    const date = new Date('2026-09-15T10:00:00Z');

    expect(buildBranchName('mazur', 123, date)).toBe('mazur-15.09.2026-123');
  });

  it('lower-cases and sanitizes an unsafe username to [a-z0-9-]', () => {
    const date = new Date('2026-01-05T10:00:00Z');

    expect(buildBranchName('Bogdan.Mazur@Ex', 7, date)).toBe('bogdan-mazur-ex-05.01.2026-7');
  });

  it('falls back to "user" when the username sanitizes to nothing', () => {
    const date = new Date('2026-01-05T10:00:00Z');

    expect(buildBranchName('...', 1, date)).toBe('user-05.01.2026-1');
  });
});

describe('checkoutTaskBranch', () => {
  it('switches onto the task branch from whatever was checked out before', async () => {
    const dir = initRepo();
    git(dir, ['branch', 'task-branch']);
    expect(git(dir, ['branch', '--show-current']).trim()).toBe('master');

    await checkoutTaskBranch(dir, 'task-branch');

    expect(git(dir, ['branch', '--show-current']).trim()).toBe('task-branch');
  });

  it('a subsequent commit lands on the task branch, leaving master exactly where it was', async () => {
    const dir = initRepo();
    git(dir, ['branch', 'task-branch']);
    const masterBefore = git(dir, ['rev-parse', 'master']).trim();

    await checkoutTaskBranch(dir, 'task-branch');
    writeFileSync(path.join(dir, 'pulled.txt'), 'content');
    await commitPulledFiles(dir, ['pulled.txt'], 'Pull issue #1');

    expect(git(dir, ['rev-parse', 'master']).trim()).toBe(masterBefore);
    expect(git(dir, ['log', '-1', '--format=%s', 'task-branch'])).toContain('Pull issue #1');
  });

  it('refuses to switch branches when the tree is dirty', async () => {
    const dir = initRepo();
    git(dir, ['branch', 'task-branch']);
    writeFileSync(path.join(dir, 'uncommitted.txt'), 'oops');

    await expect(checkoutTaskBranch(dir, 'task-branch')).rejects.toThrow('незакоммиченные изменения');
  });
});

describe('commitPulledFiles', () => {
  it('commits only the given paths, leaving other uncommitted changes untouched', async () => {
    const dir = initRepo();
    writeFileSync(path.join(dir, 'pulled.txt'), 'from the parcel');
    writeFileSync(path.join(dir, 'unrelated.txt'), 'the developer\'s own in-progress work');

    await commitPulledFiles(dir, ['pulled.txt'], 'Pull issue #1: test');

    const committed = git(dir, ['show', '--stat', '--format=', 'HEAD']);
    expect(committed).toContain('pulled.txt');
    expect(committed).not.toContain('unrelated.txt');

    const status = git(dir, ['status', '--porcelain']);
    expect(status).toContain('unrelated.txt');
  });

  it('still makes a real commit when the parcel wrote no files (--allow-empty)', async () => {
    const dir = initRepo();
    const before = git(dir, ['rev-parse', 'HEAD']).trim();

    await commitPulledFiles(dir, [], 'Pull issue #2: no file changes');

    const after = git(dir, ['rev-parse', 'HEAD']).trim();
    expect(after).not.toBe(before);
    expect(git(dir, ['log', '-1', '--format=%s'])).toContain('Pull issue #2');
  });
});

describe('pushBranch', () => {
  it('pushes the current branch to origin, and only that branch', async () => {
    const remote = mkdtempSync(path.join(tmpdir(), 'reports-git-test-remote-'));
    git(remote, ['init', '--quiet', '--bare']);

    const dir = initRepo();
    git(dir, ['remote', 'add', 'origin', remote]);
    git(dir, ['checkout', '-b', 'mazur-28.09.2026-1']);
    writeFileSync(path.join(dir, 'pulled.txt'), 'content');
    await commitPulledFiles(dir, ['pulled.txt'], 'Pull issue #1');

    await pushBranch(dir, 'mazur-28.09.2026-1');

    const branchesOnRemote = git(remote, ['branch', '--list']);
    expect(branchesOnRemote).toContain('mazur-28.09.2026-1');
    // The task branch's own commit landed on the remote — confirms this
    // pushed real content, not just an empty ref.
    const remoteLog = git(remote, ['log', '-1', '--format=%s', 'mazur-28.09.2026-1']);
    expect(remoteLog.trim()).toBe('Pull issue #1');
  });
});
