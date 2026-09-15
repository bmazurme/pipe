import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { BridgeClient } from '../bridgeClient.js';
import { findProject, loadConfig } from '../config.js';
import { loadDictionary, toLocal } from '../dictionary.js';
import { decryptBuffer } from '../encryption.js';
import { isGitTreeClean } from '../gitStatus.js';
import { extractIssue, extractIssueArchive } from '../issuePack.js';
import { resolveFromRoot } from '../paths.js';
import { issueParcelName } from './pushIssue.js';

export async function pullIssueCommand(
  name: string,
  projectId: string,
  iid: string,
  options: { force?: boolean },
): Promise<void> {
  const config = loadConfig();
  const project = findProject(config, name);

  if (!options.force && !isGitTreeClean(project.path)) {
    throw new Error(
      `${project.path} has uncommitted changes — commit/stash them first, or re-run with --force ` +
        'to overwrite anyway.',
    );
  }

  const dictionary = loadDictionary(project.dictionary);
  const client = new BridgeClient(config.bridge.apiUrl);

  const plainName = issueParcelName(projectId, iid, false);
  const encryptedName = issueParcelName(projectId, iid, true);
  const candidates = (await client.listFiles())
    .filter((f) => f.originalName === plainName || f.originalName === encryptedName)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const newest = candidates[0];
  if (!newest) {
    console.log(`Nothing to pull for issue #${iid} (project ${projectId}) — no one has pushed it yet.`);
    return;
  }

  const isEncrypted = newest.originalName === encryptedName;
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
    console.log(
      `Warning: "${newest.originalName}" used the legacy ${'__sync_manifest__.json'} format — ` +
        'no issue title/description/branch is available for it.',
    );
  } else {
    const issueFile = extractIssue(project.path, manifest, dictionary, newest.id);
    console.log(`Issue #${manifest.issueIid}: ${issueFile.title}`);
    if (issueFile.description) console.log(issueFile.description);
    console.log(`Branch: ${manifest.branch}`);
    console.log(`Issue text extracted to ${issueFile.path}`);
  }

  console.log(
    `Pulled ${files.length} files into ${project.path}${isEncrypted ? ' (decrypted)' : ''}.`,
  );
}
