#!/usr/bin/env node
import { Command } from 'commander';

import { addCommand, listCommand, removeCommand } from './commands/add.js';
import { loginCommand } from './commands/login.js';
import { loginGitlabCommand } from './commands/loginGitlab.js';
import { generateKeysCommand } from './commands/generateKeys.js';
import { pushCommand } from './commands/push.js';
import { pullCommand } from './commands/pull.js';
import { pushIssueCommand } from './commands/pushIssue.js';
import { pullIssueCommand } from './commands/pullIssue.js';
import { setupProxy } from './setupProxy.js';

setupProxy();

const program = new Command();

program
  .name('sync-cli')
  .description(
    'Syncs a JS/TS project tree with another machine through bridge storage, ' +
      'swapping real values for dictionary keys on the way out and back on the way in.',
  );

program
  .command('login <refreshToken>')
  .description('Store bridge\'s refresh token (copy the bridgeRefreshToken cookie value after signing in via a browser)')
  .action(loginCommand);

program
  .command('add <name> <path> <dictionary>')
  .description('Track a project folder under <name>, using the given dictionary file')
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
  .action((name, projectId, iid) => pushIssueCommand(name, projectId, iid));

program
  .command('pull-issue <name> <projectId> <iid>')
  .description(
    'Download and transform the latest parcel addressed to one GitLab issue, ' +
      'compatible with reports\' Subscription module',
  )
  .option('-f, --force', 'pull even with a dirty git tree')
  .action((name, projectId, iid, options) => pullIssueCommand(name, projectId, iid, options));

program
  .command('generate-keys <name>')
  .description(
    'Generate an RSA-4096 keypair at the project\'s publicKeyPath/privateKeyPath, for push-issue/pull-issue encryption',
  )
  .option('-f, --force', 'overwrite existing key files')
  .action((name, options) => generateKeysCommand(name, options));

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
  console.error(describeError(error));
  process.exitCode = 1;
});
