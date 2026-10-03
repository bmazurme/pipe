#!/usr/bin/env node
import { Command } from 'commander';

import { addCommand, listCommand, removeCommand } from './commands/add.js';
import { loginCommand } from './commands/login.js';
import { loginGitlabCommand } from './commands/loginGitlab.js';
import { loginApiKeyCommand } from './commands/loginApiKey.js';
import { generateKeysCommand } from './commands/generateKeys.js';
import { agentRunnerCommand } from './commands/agentRunner.js';
import { pushCommand } from './commands/push.js';
import { pullCommand } from './commands/pull.js';
import { pushIssueCommand } from './commands/pushIssue.js';
import { pullIssueCommand } from './commands/pullIssue.js';
import { gitlabWorkerCommand } from './commands/gitlabWorker.js';
import { log, setVerbose } from './log.js';
import { setupProxy } from './setupProxy.js';

setupProxy();

const program = new Command();

program
  .name('sync-cli')
  .description(
    'Syncs a JS/TS project tree with another machine through bridge storage, ' +
      'swapping real values for dictionary keys on the way out and back on the way in.',
  )
  .option('-v, --verbose', 'show debug-level output')
  .hook('preAction', (thisCommand) => {
    setVerbose(Boolean(thisCommand.opts().verbose));
  });

program
  .command('login <refreshToken>')
  .description('Store bridge\'s refresh token (copy the bridgeRefreshToken cookie value after signing in via a browser)')
  .action(loginCommand);

program
  .command('login-api-key <apiKey>')
  .description(
    'Store a bridge personal API key (mint one from bridge\'s Profile page → API keys) — ' +
      'preferred over "login" for an unattended machine, since it does not impersonate a human session',
  )
  .action(loginApiKeyCommand);

program
  .command('add <name> <path> [dictionary]')
  .description('Track a project folder under <name>; omit dictionary for a project that never de-/anonymizes (e.g. agent-runner)')
  .action(addCommand);

program
  .command('remove <name>')
  .description('Stop tracking a project')
  .action(removeCommand);

program
  .command('list')
  .description('List tracked projects')
  .action(listCommand);

program
  .command('push <name>')
  .description('Transform (value->key) and upload a tracked project to bridge')
  .option('-f, --force', 'push even if content hash is unchanged')
  .option('--strict', 'abort instead of just warning when the leak scan finds something')
  .action((name, options) => pushCommand(name, options));

program
  .command('pull <name>')
  .description('Download and transform (key->value) the latest push for a tracked project')
  .option('-f, --force', 'pull even with a dirty git tree / unchanged hash')
  .action((name, options) => pullCommand(name, options));

program
  .command('login-gitlab <token>')
  .description('Store a GitLab personal access token, used by push-issue to read issue title/description')
  .action(loginGitlabCommand);

program
  .command('push-issue <name> <projectId> <iid>')
  .description(
    'Transform and upload a tracked project as a parcel addressed to one GitLab issue ' +
      '(${projectId}-${iid}.subscription.zip), compatible with reports\' Subscription module',
  )
  .option('--strict', 'abort instead of just warning when the leak scan finds something')
  .action((name, projectId, iid, options) => pushIssueCommand(name, projectId, iid, options));

program
  .command('pull-issue <name> <projectId> <iid>')
  .description(
    'Download and transform the latest parcel addressed to one GitLab issue, ' +
      'compatible with reports\' Subscription module',
  )
  .option('-f, --force', 'pull even with a dirty git tree')
  .option('-w, --watch <seconds>', 'keep polling every <seconds> until the result appears, then notify and exit')
  .action((name, projectId, iid, options) => pullIssueCommand(name, projectId, iid, options));

program
  .command('gitlab-worker <name>')
  .description(
    'Poll GitLab for open issues assigned to you on this project, and push-issue each one not already sent, ' +
      'without having to type the issue id by hand',
  )
  .option('-w, --watch <seconds>', 'keep polling every <seconds> instead of a single pass')
  .option('--strict', 'skip (instead of just warning on) an issue whose leak scan finds something')
  .action((name, options) => gitlabWorkerCommand(name, options));

program
  .command('generate-keys <name>')
  .description(
    'Generate an RSA-4096 keypair at the project\'s publicKeyPath/privateKeyPath, for push-issue/pull-issue encryption',
  )
  .option('-f, --force', 'overwrite existing key files')
  .action((name, options) => generateKeysCommand(name, options));

program
  .command('agent-runner <name>')
  .description(
    'Poll bridge for GitLab-issue parcels, run Claude Code on each in an isolated git worktree, ' +
      'push before/after commits to the branch on origin, and push the result back to bridge. ' +
      'No dictionary is used here — de-/anonymization stays reports\' responsibility.',
  )
  .option('-w, --watch <seconds>', 'keep polling every <seconds> instead of a single pass')
  .option(
    '--review',
    'pause before each dispatch to review/edit the issue and pick a model — not compatible with --watch',
  )
  .action((name, options) => agentRunnerCommand(name, options));

// fetch() wraps every network-level failure (DNS, TCP, TLS, proxy) as a bare
// "TypeError: fetch failed" — the actual reason only shows up in `.cause`,
// possibly nested (a proxy failure's cause is itself another error).
function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;

  while (current) {
    parts.push(current instanceof Error ? current.message : String(current));
    current = current instanceof Error ? current.cause : undefined;
  }

  return parts.join('\n  caused by: ');
}

program.parseAsync(process.argv).catch((error: unknown) => {
  log.error(describeError(error));
  process.exitCode = 1;
});
