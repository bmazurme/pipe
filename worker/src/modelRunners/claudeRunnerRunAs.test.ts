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

  // The regression this file exists for: the check and what the image lets the worker run disagreed (the rule allowed claude only, the check ran `true`), so
  // the worker refused to start with WORKER_RUN_AS set and the isolation was never switched on. In the image the user switch is `setpriv` (S1): the check
  // must be the very command a job runs, and the image must contain both programs it names.
  it('is the command a job runs, and the image has the programs it names', () => {
    const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf-8');
    const before = process.env.WORKER_RUN_AS_VIA;

    process.env.WORKER_RUN_AS_VIA = 'setpriv';

    try {
      const check = claudeCommand(['--version'], 'pipe-runner');
      const job = claudeCommand(['-p', '--model', 'haiku'], 'pipe-runner');

      assert.equal(check.command, 'setpriv');
      assert.deepEqual(check.args.slice(0, check.args.indexOf('claude')), job.args.slice(0, job.args.indexOf('claude')));
      assert.equal(check.args[check.args.indexOf('claude') + 1], '--version');
      assert.ok(dockerfile.includes('apk add --no-cache setpriv'));
      assert.ok(dockerfile.includes('npm install -g @anthropic-ai/claude-code'));
      assert.ok(dockerfile.includes('ENV WORKER_RUN_AS_VIA=setpriv'));
    } finally {
      if (before === undefined) delete process.env.WORKER_RUN_AS_VIA;
      else process.env.WORKER_RUN_AS_VIA = before;
    }
  });

  it('on a bare-metal install it is still the sudo form the sudoers rule allows', () => {
    const cmd = claudeCommand(['--version'], 'pipe-runner', );

    assert.equal(cmd.command, 'sudo');
    assert.deepEqual(cmd.args, ['-n', '-E', '-u', 'pipe-runner', 'claude', '--version']);
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
  const entry = readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf-8');

  // sudo used to reset the umask for the runner (umask_override). setpriv changes nothing about it, so the runner inherits the worker's own: group-writable.
  it('lets the runner inherit the worker\'s group-writable umask (setpriv does not reset it)', () => {
    assert.ok(entry.includes('process.umask(0o002)'));
    assert.ok(!/umask\s+[0-7]{3,4}/.test(dockerfile.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n')));
  });
});
