import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { claudeCommand, shareRunDir, verifyRunAs } from './claudeRunner.js';

type Spawn = Parameters<typeof verifyRunAs>[1];

describe('verifyRunAs', () => {
  it('runs the command a job runs: sudo -n -E -u <user> claude --version', () => {
    const calls: Array<[string, string[]]> = [];
    const spawn = ((command: string, args: string[]) => {
      calls.push([command, args]);

      return { status: 0 };
    }) as unknown as Spawn;

    verifyRunAs('pipe-runner', spawn);

    assert.deepEqual(calls, [['sudo', ['-n', '-E', '-u', 'pipe-runner', 'claude', '--version']]]);
  });

  it('throws, naming the command, when sudo refuses or the process cannot start', () => {
    assert.throws(() => verifyRunAs('pipe-runner', (() => ({ status: 1 })) as unknown as Spawn), /sudo -n -E -u pipe-runner claude --version/);
    assert.throws(() => verifyRunAs('pipe-runner', (() => ({ status: null, error: new Error('ENOENT') })) as unknown as Spawn), /failed/);
  });

  // The regression this file exists for: the check and the image's sudoers rule disagreed (the rule allowed claude only, the check ran `true`),
  // so the worker refused to start with WORKER_RUN_AS set and the isolation was never switched on.
  it('is allowed by the sudoers rule the image installs', () => {
    const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf-8');
    const rule = /pipe-worker ALL=\(([^)\s]+)\) NOPASSWD:SETENV: ([^\s']+)/.exec(dockerfile);

    assert.ok(rule, 'the Dockerfile has no sudoers rule for the runner');

    const [, user, allowed] = rule;
    const cmd = claudeCommand(['--version'], user);
    // sudo resolves the program name the way the rule's path does: the rule must name the same program the check (and every job) runs.
    const program = cmd.args[cmd.args.indexOf('-u') + 2];

    assert.equal(cmd.command, 'sudo');
    assert.equal(allowed.split('/').pop(), program);
    assert.ok(cmd.args.includes('-E'), 'the rule allows SETENV, which -E needs');
  });
});

// The regression of 2026-11-27: with the isolation on, every job that had to WRITE failed with «no write permission» — the worker unpacked the parcel with
// umask 022 (directories 755, files 644), and the runner, in the group but only able to read, could not change a file.
describe('shareRunDir', () => {
  const mode = (file: string) => statSync(file).mode & 0o7777;

  function unpacked(): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'share-run-dir-'));
    mkdirSync(path.join(dir, 'src', 'deep'), { recursive: true });
    writeFileSync(path.join(dir, 'a.ts'), 'one');
    writeFileSync(path.join(dir, 'src', 'deep', 'b.ts'), 'two');
    // what the worker's umask 022 left: nothing writable for the group
    chmodSync(dir, 0o755);
    chmodSync(path.join(dir, 'src'), 0o755);
    chmodSync(path.join(dir, 'src', 'deep'), 0o755);
    chmodSync(path.join(dir, 'a.ts'), 0o644);
    chmodSync(path.join(dir, 'src', 'deep', 'b.ts'), 0o644);

    return dir;
  }

  it('opens the whole unpacked tree to the group: directories rwx + setgid, files rw', () => {
    const dir = unpacked();

    shareRunDir(dir, 'pipe-runner');

    assert.equal(mode(dir), 0o2770);
    assert.equal(mode(path.join(dir, 'src')), 0o2775);
    assert.equal(mode(path.join(dir, 'src', 'deep')), 0o2775);
    assert.equal(mode(path.join(dir, 'a.ts')) & 0o660, 0o660);
    assert.equal(mode(path.join(dir, 'src', 'deep', 'b.ts')) & 0o660, 0o660);
  });

  it('only adds: an executable file stays executable, and nothing loses a bit it had', () => {
    const dir = unpacked();

    chmodSync(path.join(dir, 'a.ts'), 0o755);
    shareRunDir(dir, 'pipe-runner');

    assert.equal(mode(path.join(dir, 'a.ts')), 0o775);
  });

  it('does nothing without WORKER_RUN_AS: the worker runs the job as itself', () => {
    const dir = unpacked();

    shareRunDir(dir, undefined);

    assert.equal(mode(path.join(dir, 'a.ts')), 0o644);
    assert.equal(mode(path.join(dir, 'src')), 0o755);
  });

  it('does not follow a symlink out of the directory', () => {
    const dir = unpacked();
    const outside = mkdtempSync(path.join(tmpdir(), 'share-run-dir-outside-'));

    writeFileSync(path.join(outside, 'secret'), 'x');
    chmodSync(path.join(outside, 'secret'), 0o600);
    const outsideBefore = mode(outside);
    symlinkSync(outside, path.join(dir, 'link'));
    symlinkSync(path.join(outside, 'secret'), path.join(dir, 'secret-link'));

    shareRunDir(dir, 'pipe-runner');

    assert.equal(mode(path.join(outside, 'secret')), 0o600);
    assert.equal(mode(outside), outsideBefore);
  });
});

describe('the image makes what the runner creates deletable by the worker', () => {
  const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf-8');

  it('gives sudo a group-writable umask for the worker, and makes it the one used (umask_override)', () => {
    assert.ok(dockerfile.includes("'Defaults:pipe-worker umask=0002'"));
    assert.ok(dockerfile.includes("'Defaults:pipe-worker umask_override'"));
  });
});

