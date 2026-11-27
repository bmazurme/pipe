// How job code is started as another OS user (WORKER_RUN_AS), and what that user's environment looks like. Two ways:
//
//   sudo    — the bare-metal install (systemd/pipe-worker.service): `sudo -n -E -u <user> …`, allowed by a sudoers rule. The default.
//   setpriv — the container image (S1): no sudo at all. sudo is a setuid binary, which `no-new-privileges` forbids and `--cap-drop ALL` starves, so a
//             hardened container could not use it. Instead the image's entrypoint starts the worker with only CAP_SETUID and CAP_SETGID kept (as ambient
//             capabilities), and the worker starts job code through `setpriv`, which switches user and group, keeps NO capability and sets no-new-privs
//             before it executes anything. What job code inherits is a process with the runner's uid, no capabilities and no way to gain any.
//
// Pure: it builds argv and env; the callers spawn.

export type RunAsVia = 'sudo' | 'setpriv';

export function runAsVia(env: NodeJS.ProcessEnv = process.env): RunAsVia {
  const value = (env.WORKER_RUN_AS_VIA ?? '').trim().toLowerCase();

  if (value === '' || value === 'sudo') return 'sudo';
  if (value === 'setpriv') return 'setpriv';

  throw new Error(`WORKER_RUN_AS_VIA must be "sudo" or "setpriv", got "${env.WORKER_RUN_AS_VIA}"`);
}

// The primary group the job user is started with: the one the worker shares the work directory through.
export function runAsGroup(env: NodeJS.ProcessEnv = process.env): string {
  return env.WORKER_RUN_AS_GROUP?.trim() || 'pipe-jobs';
}

export function asUser(
  runAs: string,
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): { command: string; args: string[] } {
  if (runAsVia(env) === 'sudo') {
    return { command: 'sudo', args: ['-n', '-E', '-u', runAs, ...argv] };
  }

  return {
    command: 'setpriv',
    args: [
      `--reuid=${runAs}`,
      `--regid=${runAsGroup(env)}`,
      '--init-groups',
      '--inh-caps=-all',
      '--ambient-caps=-all',
      '--no-new-privs',
      ...argv,
    ],
  };
}

// The worker's own HOME and USER are not the job user's. sudo sets them for the target user; setpriv does not, so they are set here.
export function applyRunnerIdentity(
  env: NodeJS.ProcessEnv,
  runAs: string,
  via: RunAsVia = runAsVia(),
  source: NodeJS.ProcessEnv = process.env,
): void {
  if (via === 'sudo') {
    delete env.HOME;
    delete env.USER;

    return;
  }

  env.HOME = source.WORKER_RUN_AS_HOME?.trim() || `/home/${runAs}`;
  env.USER = runAs;
  env.LOGNAME = runAs;
}
