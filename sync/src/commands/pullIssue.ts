import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { notify } from '@pipe/protocol/notify';

import { BridgeClient } from '../bridgeClient.js';
import { findProject, loadConfig } from '../config.js';
import { loadOptionalDictionary, toLocal } from '../dictionary.js';
import { decryptBuffer } from '../encryption.js';
import { isGitTreeClean } from '../gitStatus.js';
import { extractIssue, extractIssueArchive } from '../issuePack.js';
import { resolveFromRoot } from '../paths.js';
import { log } from '../log.js';

// Returns true once a parcel was found and pulled, false when there's
// nothing on bridge yet — the shape --watch below polls on.
async function tryPullOnce(
  name: string,
  projectId: string,
  iid: string,
  options: { force?: boolean },
): Promise<boolean> {
  const config = loadConfig();
  const project = findProject(config, name);

  if (!options.force && !isGitTreeClean(project.path)) {
    throw new Error(
      `${project.path} has uncommitted changes — commit/stash them first, or re-run with --force ` +
        'to overwrite anyway.',
    );
  }

  const dictionary = loadOptionalDictionary(project.dictionary);
  const client = new BridgeClient(config.bridge.apiUrl);

  // Matched by addressing metadata (IMPROVEMENTS_TECH.md 2.3), not by
  // filename — a filename-only match couldn't tell this task's *result*
  // apart from its own outbound parcel (agent-runner uploads both under
  // the exact same issueParcelName()), if the outbound one were ever still
  // sitting in storage (e.g. never downloaded) when the result arrives.
  const candidates = (await client.listFiles({ channel: 'issue', taskKey: `${projectId}:${iid}`, direction: 'result' }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const newest = candidates[0];
  if (!newest) {
    log.info(`Nothing to pull for issue #${iid} (project ${projectId}) — no one has pushed it yet.`);
    return false;
  }

  const isEncrypted = newest.originalName.endsWith('.enc');
  const downloaded = await client.download(newest.id);

  let buffer = downloaded;
  if (isEncrypted) {
    if (!project.privateKeyPath) {
      throw new Error(
        `"${newest.originalName}" is encrypted, but project "${name}" has no privateKeyPath configured ` +
          'in sync.config.json.',
      );
    }
    buffer = decryptBuffer(downloaded, readFileSync(resolveFromRoot(project.privateKeyPath), 'utf-8'));
  }

  const { manifest, files, legacyManifest } = extractIssueArchive(buffer);

  for (const file of files) {
    const destination = path.join(project.path, file.relPath);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, toLocal(dictionary, file.content), 'utf-8');
  }

  if (legacyManifest) {
    log.info(
      `Warning: "${newest.originalName}" used the legacy ${'__sync_manifest__.json'} format — ` +
        'no issue title/description/branch is available for it.',
    );
  } else {
    const issueFile = extractIssue(project.path, manifest, dictionary, newest.id);
    log.info(`Issue #${manifest.issueIid}: ${issueFile.title}`);
    if (issueFile.description) log.info(issueFile.description);
    log.info(`Branch: ${manifest.branch}`);
    log.info(`Issue text extracted to ${issueFile.path}`);
  }

  log.info(
    `Pulled ${files.length} files into ${project.path}${isEncrypted ? ' (decrypted)' : ''}.`,
  );

  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pullIssueCommand(
  name: string,
  projectId: string,
  iid: string,
  options: { force?: boolean; watch?: string },
): Promise<void> {
  if (!options.watch) {
    await tryPullOnce(name, projectId, iid, options);
    return;
  }

  const intervalSec = Number(options.watch);
  if (!Number.isFinite(intervalSec) || intervalSec <= 0) {
    throw new Error(`--watch expects a positive number of seconds, got "${options.watch}".`);
  }

  log.info(`Watching for issue #${iid} (project ${projectId})'s result every ${intervalSec}s. Ctrl+C to stop.`);
  for (;;) {
    const found = await tryPullOnce(name, projectId, iid, options);
    if (found) {
      notify('Result ready', `Issue #${iid} (project ${projectId}) pulled into ${findProject(loadConfig(), name).path}.`);
      return;
    }
    await sleep(intervalSec * 1000);
  }
}
