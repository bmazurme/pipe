import { readFileSync } from 'node:fs';

import { formatLeakFindings, scanForLeaks } from '@pipe/protocol';

import { BridgeClient } from '../bridgeClient.js';
import { findProject, loadConfig, projectExclude, projectInclude } from '../config.js';
import { loadCredentialsOrEmpty } from '../credentials.js';
import { loadOptionalDictionary, toRemote } from '../dictionary.js';
import { encryptBuffer } from '../encryption.js';
import { getCurrentBranch } from '../gitStatus.js';
import { getIssue } from '../gitlabClient.js';
import { buildIssueArchive } from '../issuePack.js';
import { resolveFromRoot } from '../paths.js';
import { readAndTransform } from '../pack.js';
import { walkProjectFiles } from '../walk.js';

// Matches reports' subscription/handler.ts parcelName(): `${projectId}-${iid}.subscription.zip[.enc]`.
export function issueParcelName(projectId: string, iid: string, encrypted: boolean): string {
  return `${projectId}-${iid}.subscription.zip${encrypted ? '.enc' : ''}`;
}

export async function pushIssueCommand(name: string, projectId: string, iid: string): Promise<void> {
  const config = loadConfig();
  const project = findProject(config, name);
  const dictionary = loadOptionalDictionary(project.dictionary);

  if (!config.gitlab?.apiUrl) {
    throw new Error(
      'GitLab is not configured — add "gitlab": { "apiUrl": "https://<host>/api/v4" } to sync.config.json.',
    );
  }

  const { gitlabToken } = loadCredentialsOrEmpty();
  if (!gitlabToken) {
    throw new Error('Not logged in to GitLab. Run "sync-cli login-gitlab <token>" first.');
  }

  const issue = await getIssue(config.gitlab.apiUrl, gitlabToken, projectId, iid);

  const relPaths = await walkProjectFiles(project.path, projectInclude(project), projectExclude(project));
  if (relPaths.length === 0) {
    console.log(`No files matched include/exclude patterns under ${project.path}.`);
    return;
  }

  const files = readAndTransform(project.path, relPaths, (text) => toRemote(dictionary, text));
  const branch = getCurrentBranch(project.path);
  const issueTitle = toRemote(dictionary, issue.title);
  const issueDescription = toRemote(dictionary, issue.description ?? '');

  const leaks = scanForLeaks([
    ...files.map((f) => ({ source: f.relPath, content: f.content })),
    { source: 'issue title', content: issueTitle },
    { source: 'issue description', content: issueDescription },
  ]);
  if (leaks.length > 0) {
    console.warn(formatLeakFindings(leaks));
  }

  const archive = buildIssueArchive(files, {
    issueId: String(issue.id),
    issueIid: String(issue.iid),
    issueTitle,
    issueDescription,
    projectId: issue.project_id,
    branch,
    createdAt: new Date().toISOString(),
  });

  const shouldEncrypt = Boolean(project.publicKeyPath);
  const buffer = shouldEncrypt
    ? encryptBuffer(archive, readFileSync(resolveFromRoot(project.publicKeyPath!), 'utf-8'))
    : archive;

  const filename = issueParcelName(projectId, iid, shouldEncrypt);
  const client = new BridgeClient(config.bridge.apiUrl);
  const stored = await client.upload(filename, buffer);

  console.log(
    `Pushed issue #${iid} (project ${projectId}) as "${filename}" (${files.length} files, ${stored.size} bytes, ` +
      `storage id ${stored.id}, branch "${branch}"${shouldEncrypt ? ', encrypted' : ''}).`,
  );
}
