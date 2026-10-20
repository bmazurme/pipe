import { unzip, type Unzipped } from 'fflate';

import {
  ASSET_PREFIX,
  Change,
  isExcludedPath,
  MANIFEST_ENTRY,
} from '../improve/parcel';

// Lab, unlike Improve, publishes what a worker made as it is — drawings, images and other binaries included. The worker sends the
// files that are not valid UTF-8 as `__issue_assets__/` entries; Improve drops them on purpose (its results are text), Lab keeps them.
// The snapshot handed to the worker holds text only, so every such entry is a file the worker made.
export const LAB_MAX_CHANGED_FILES = 200;
export const LAB_MAX_CHANGED_BYTES = 50 * 1024 * 1024;

function unzipAsync(data: Uint8Array): Promise<Unzipped> {
  return new Promise((resolve, reject) => {
    unzip(data, (error, out) => (error ? reject(error) : resolve(out)));
  });
}

export interface LabResult {
  /** Text files left on disk (edited, new, untouched), by path. */
  files: Map<string, Uint8Array>;
  /** Binary files the worker made, by path. */
  binaries: Map<string, Uint8Array>;
}

export async function readLabResult(data: Uint8Array): Promise<LabResult> {
  const files = new Map<string, Uint8Array>();
  const binaries = new Map<string, Uint8Array>();

  for (const [name, bytes] of Object.entries(await unzipAsync(data))) {
    if (name.endsWith('/') || name === MANIFEST_ENTRY) continue;

    if (name.startsWith(ASSET_PREFIX)) {
      const path = name.slice(ASSET_PREFIX.length);

      if (path && !isExcludedPath(path)) binaries.set(path, bytes);

      continue;
    }

    if (!isExcludedPath(name)) files.set(name, bytes);
  }

  return { files, binaries };
}

// The text changes against the baseline, plus every binary as an addition (a binary at an existing path simply replaces it).
export function withBinaries(
  textChanges: Change[],
  binaries: Map<string, Uint8Array>,
): Change[] {
  const changes = textChanges.filter((change) => !binaries.has(change.path));

  for (const [path, bytes] of binaries)
    changes.push({ path, kind: 'added', bytes });

  return changes.sort((a, b) => a.path.localeCompare(b.path));
}
