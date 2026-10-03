import { formatLeakFindings, scanForLeaks } from '@pipe/protocol';

import { BridgeClient } from '../bridgeClient.js';
import { findProject, loadConfig, projectExclude, projectInclude } from '../config.js';
import { loadOptionalDictionary, toRemote } from '../dictionary.js';
import { buildArchive, readAndTransform } from '../pack.js';
import { getLastHash, setLastHash } from '../state.js';
import { walkProjectFiles } from '../walk.js';
import { log } from '../log.js';

export async function pushCommand(
  name: string,
  options: { force?: boolean; strict?: boolean },
): Promise<void> {
  const config = loadConfig();
  const project = findProject(config, name);
  const dictionary = loadOptionalDictionary(project.dictionary);

  const relPaths = await walkProjectFiles(project.path, projectInclude(project), projectExclude(project));
  if (relPaths.length === 0) {
    log.info(`No files matched include/exclude patterns under ${project.path}.`);
    return;
  }

  const files = readAndTransform(project.path, relPaths, (text) => toRemote(dictionary, text));

  const leaks = scanForLeaks(files.map((f) => ({ source: f.relPath, content: f.content })));
  if (leaks.length > 0) {
    log.warn(formatLeakFindings(leaks));

    if (options.strict) {
      throw new Error(
        `--strict: ${leaks.length} possible leak(s) found — aborting push. Re-run without --strict to push anyway.`,
      );
    }
  }

  const { buffer, manifest } = buildArchive(name, files);

  if (!options.force && manifest.contentHash === getLastHash(name)) {
    log.info('Nothing changed since the last push.');
    return;
  }

  const client = new BridgeClient(config.bridge.apiUrl);
  const stored = await client.upload(`${name}.sync.zip`, buffer);

  setLastHash(name, manifest.contentHash);
  log.info(
    `Pushed "${name}" (${files.length} files, ${stored.size} bytes, storage id ${stored.id}). ` +
      'The other machine can now pull it.',
  );
}
