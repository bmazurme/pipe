import { BridgeClient } from '../bridgeClient.js';
import { findProject, loadConfig } from '../config.js';
import { loadOptionalDictionary, toLocal } from '../dictionary.js';
import { extractArchive } from '../pack.js';
import { isGitTreeClean } from '../gitStatus.js';
import { getLastHash, setLastHash } from '../state.js';
import { log } from '../log.js';
import { writeParcelFiles } from '../writeParcelFiles.js';

export async function pullCommand(name: string, options: { force?: boolean }): Promise<void> {
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

  const filename = `${name}.sync.zip`;
  const candidates = (await client.listFiles())
    .filter((f) => f.originalName === filename)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (candidates.length === 0) {
    log.info(`Nothing to pull for "${name}" — no one has pushed it yet.`);
    return;
  }

  // Only the newest of any stale extras is meaningful; older ones are
  // leftovers from a skipped pull. Peeked, not downloaded: the parcel is
  // deleted on bridge only once it is applied (or known to be up to date).
  const buffer = await client.peek(candidates[0].id);
  const { files, manifest } = extractArchive(buffer);

  if (!options.force && manifest.contentHash === getLastHash(name)) {
    await client.delete(candidates[0].id);
    log.info('Already up to date.');
    return;
  }

  writeParcelFiles(project.path, files, (content) => toLocal(dictionary, content));

  setLastHash(name, manifest.contentHash);
  await client.delete(candidates[0].id);
  log.info(`Pulled "${name}" (${files.length} files) from ${manifest.machine}, applied at ${project.path}.`);
}
