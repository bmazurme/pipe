import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { claudeCommand, verifyRunAs } from './claudeRunner.js';

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
