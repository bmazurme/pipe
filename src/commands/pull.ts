import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { BridgeClient } from '../bridgeClient.js';
import { findProject, loadConfig } from '../config.js';
import { loadDictionary, toLocal } from '../dictionary.js';
import { extractArchive } from '../pack.js';
import { isGitTreeClean } from '../gitStatus.js';
import { getLastHash, setLastHash } from '../state.js';

export async function pullCommand(name: string, options: { force?: boolean }): Promise<void> {
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

  const filename = `${name}.sync.zip`;
  const candidates = (await client.listFiles())
    .filter((f) => f.originalName === filename)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (candidates.length === 0) {
    console.log(`Nothing to pull for "${name}" — no one has pushed it yet.`);
    return;
  }

  // Pulling consumes (deletes) the file on bridge, so only the newest of any
  // stale extras is meaningful; older ones are leftovers from a skipped pull.
  const buffer = await client.download(candidates[0].id);
  const { files, manifest } = extractArchive(buffer);

  if (!options.force && manifest.contentHash === getLastHash(name)) {
    console.log('Already up to date.');
    return;
  }

  for (const file of files) {
    const destination = path.join(project.path, file.relPath);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, toLocal(dictionary, file.content), 'utf-8');
  }

  setLastHash(name, manifest.contentHash);
  console.log(`Pulled "${name}" (${files.length} files) from ${manifest.machine}, applied at ${project.path}.`);
}
