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

  it('is a no-op when there is no "origin" remote at all (e.g. no prior push)', async () => {
    const dir = initRepo();
    git(dir, ['branch', 'task-branch']);

    await expect(checkoutTaskBranch(dir, 'task-branch')).resolves.toBeUndefined();
    expect(git(dir, ['branch', '--show-current']).trim()).toBe('task-branch');
  });

  it('is a no-op when origin exists but has never seen this branch', async () => {
    const remote = mkdtempSync(path.join(tmpdir(), 'reports-git-test-remote-'));
    git(remote, ['init', '--quiet', '--bare']);

    const dir = initRepo();
    git(dir, ['remote', 'add', 'origin', remote]);
    git(dir, ['branch', 'task-branch']);

    await expect(checkoutTaskBranch(dir, 'task-branch')).resolves.toBeUndefined();
  });

  // Regression test: sync-cli's agent-runner pushes its own commits to the
  // same task branch from a separate clone/worktree. Before this fix, pull
  // would write+commit the parcel's files on top of a now-stale local
  // branch ref, and the subsequent `git push` was rejected as
  // non-fast-forward — after the files were already written to disk and
  // committed locally, looking like "the data landed but nothing else did".
  it('fast-forwards past commits agent-runner already pushed to origin from elsewhere', async () => {
    const remote = mkdtempSync(path.join(tmpdir(), 'reports-git-test-remote-'));
    git(remote, ['init', '--quiet', '--bare']);

    const dir = initRepo();
    git(dir, ['remote', 'add', 'origin', remote]);
    git(dir, ['checkout', '-b', 'task-branch']);
    git(dir, ['push', '-u', 'origin', 'task-branch']);

    // Simulates agent-runner's own separate clone pushing "before"/"after"
    // commits to the same branch.
    const otherClone = mkdtempSync(path.join(tmpdir(), 'reports-git-test-clone-'));
    git(otherClone, ['clone', '--quiet', remote, '.']);
    git(otherClone, ['checkout', 'task-branch']);
    writeFileSync(path.join(otherClone, 'agent-change.txt'), 'from agent-runner');
    git(otherClone, ['add', '-A']);
    git(otherClone, ['commit', '-m', 'agent-runner: after', '--quiet']);
    git(otherClone, ['push', '--quiet']);

    // `dir`'s local task-branch ref is now strictly behind origin.
    git(dir, ['checkout', 'master']);
    await checkoutTaskBranch(dir, 'task-branch');

    expect(git(dir, ['branch', '--show-current']).trim()).toBe('task-branch');
    expect(git(dir, ['log', '-1', '--format=%s']).trim()).toBe('agent-runner: after');

    // The pull's own commit on top now succeeds as a fast-forward push.
    writeFileSync(path.join(dir, 'pulled.txt'), 'content');
    await commitPulledFiles(dir, ['pulled.txt'], 'Pull issue #1');
    await expect(pushBranch(dir, 'task-branch')).resolves.toBeUndefined();
  });

  it('throws a clear error when the branch has genuinely diverged, rather than committing blindly on top', async () => {
    const remote = mkdtempSync(path.join(tmpdir(), 'reports-git-test-remote-'));
    git(remote, ['init', '--quiet', '--bare']);

    const dir = initRepo();
    git(dir, ['remote', 'add', 'origin', remote]);
    git(dir, ['checkout', '-b', 'task-branch']);
    git(dir, ['push', '-u', 'origin', 'task-branch']);

    const otherClone = mkdtempSync(path.join(tmpdir(), 'reports-git-test-clone-'));
    git(otherClone, ['clone', '--quiet', remote, '.']);
    git(otherClone, ['checkout', 'task-branch']);
    writeFileSync(path.join(otherClone, 'agent-change.txt'), 'from agent-runner');
    git(otherClone, ['add', '-A']);
    git(otherClone, ['commit', '-m', 'agent-runner: after', '--quiet']);
    git(otherClone, ['push', '--quiet']);

    // dir's own local branch also moved, independently of origin — a real
    // divergence, not a simple behind-by-N-commits case.
    writeFileSync(path.join(dir, 'local-only.txt'), 'local divergent work');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-m', 'local divergent commit', '--quiet']);

    await expect(checkoutTaskBranch(dir, 'task-branch')).rejects.toThrow('разошлась с origin');
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
