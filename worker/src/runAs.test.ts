import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyRunnerIdentity, asUser, runAsGroup, runAsVia } from './runAs.js';

describe('runAsVia', () => {
  it('is sudo unless the image says setpriv', () => {
    assert.equal(runAsVia({}), 'sudo');
    assert.equal(runAsVia({ WORKER_RUN_AS_VIA: '' }), 'sudo');
    assert.equal(runAsVia({ WORKER_RUN_AS_VIA: ' SUDO ' }), 'sudo');
    assert.equal(runAsVia({ WORKER_RUN_AS_VIA: 'Setpriv' }), 'setpriv');
  });

  it('refuses anything else instead of silently picking one', () => {
    assert.throws(() => runAsVia({ WORKER_RUN_AS_VIA: 'doas' }), /must be "sudo" or "setpriv"/);
  });
});

describe('asUser', () => {
  it('is the sudo rule the bare-metal install uses', () => {
    assert.deepEqual(asUser('pipe-runner', ['claude', '-p'], {}), {
      command: 'sudo',
      args: ['-n', '-E', '-u', 'pipe-runner', 'claude', '-p'],
    });
  });

  it('under setpriv switches user and group, keeps no capability and gains none', () => {
    const cmd = asUser('pipe-runner', ['claude', '-p'], { WORKER_RUN_AS_VIA: 'setpriv' });

    assert.equal(cmd.command, 'setpriv');
    assert.deepEqual(cmd.args, [
      '--reuid=pipe-runner',
      '--regid=pipe-jobs',
      '--init-groups',
      '--inh-caps=-all',
      '--ambient-caps=-all',
      '--no-new-privs',
      'claude',
      '-p',
    ]);
  });

  it('puts the command after every privilege-dropping option, so nothing runs before they apply', () => {
    const { args } = asUser('u', ['sh', '-c', 'id'], { WORKER_RUN_AS_VIA: 'setpriv' });

    assert.equal(args.indexOf('sh') > args.indexOf('--no-new-privs'), true);
    assert.equal(args.indexOf('sh') > args.indexOf('--ambient-caps=-all'), true);
  });

  it('takes the group from WORKER_RUN_AS_GROUP', () => {
    assert.equal(runAsGroup({}), 'pipe-jobs');
    assert.equal(runAsGroup({ WORKER_RUN_AS_GROUP: ' jobs ' }), 'jobs');
    assert.ok(asUser('u', ['x'], { WORKER_RUN_AS_VIA: 'setpriv', WORKER_RUN_AS_GROUP: 'jobs' }).args.includes('--regid=jobs'));
  });
});

describe('applyRunnerIdentity', () => {
  it('under sudo takes HOME and USER away: sudo sets the target user\'s', () => {
    const env: NodeJS.ProcessEnv = { HOME: '/home/pipe-worker', USER: 'pipe-worker', PATH: '/bin' };

    applyRunnerIdentity(env, 'pipe-runner', 'sudo', {});

    assert.deepEqual(env, { PATH: '/bin' });
  });

  it('under setpriv sets them to the job user\'s, because nothing else will', () => {
    const env: NodeJS.ProcessEnv = { HOME: '/tmp', USER: 'pipe-worker', PATH: '/bin' };

    applyRunnerIdentity(env, 'pipe-runner', 'setpriv', {});

    assert.deepEqual(env, { HOME: '/home/pipe-runner', USER: 'pipe-runner', LOGNAME: 'pipe-runner', PATH: '/bin' });
  });

  it('the home can be moved with WORKER_RUN_AS_HOME', () => {
    const env: NodeJS.ProcessEnv = {};

    applyRunnerIdentity(env, 'pipe-runner', 'setpriv', { WORKER_RUN_AS_HOME: '/run/runner' });

    assert.equal(env.HOME, '/run/runner');
  });
});
