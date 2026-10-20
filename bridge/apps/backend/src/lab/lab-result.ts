import { unzip, type Unzipped } from 'fflate';

import {
  ASSET_PREFIX,
  Change,
  isExcludedPath,
  MANIFEST_ENTRY,
  selectParcelFiles,
  sha256,
  snapshotBaseline,
  type SnapshotFile,
} from '../improve/parcel';

// Lab, unlike Improve, publishes what a worker made as it is — drawings, images and other binaries included. The worker sends the
// files that are not valid UTF-8 as `__issue_assets__/` entries; Improve drops them on purpose (its results are text), Lab keeps them.
// The binaries of the repository go to the worker as assets too (see selectLabSnapshot) and come back with the rest, so an entry is
// a change only when its hash differs from the one it was given with.
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

// The binary files of the repository (drawings, images, ...) go to the worker as `__issue_assets__/` entries, next to the text, so it can
// look at them. Improve leaves them out; Lab's projects hold reference material the task is about. A file over the size of one, or past
// the total, stays out — the worker is told which, so it does not take their absence for a missing upload.
export const LAB_MAX_BINARY_FILE_BYTES = 10 * 1024 * 1024;
export const LAB_MAX_BINARY_TOTAL_BYTES = 40 * 1024 * 1024;

const utf8 = new TextDecoder('utf-8', { fatal: true });

function isText(bytes: Uint8Array): boolean {
  try {
    utf8.decode(bytes);

    return true;
  } catch {
    return false;
  }
}

export interface LabSnapshot {
  /** Text files, as in Improve. */
  files: SnapshotFile[];
  /** Binary files, by their path in the repository. */
  binaries: SnapshotFile[];
  /** Binary files left out, with the reason. */
  skipped: string[];
  /**
   * What the result is compared with: the text files by path, the binaries under the `__issue_assets__/` prefix — the worker returns
   * every asset it was given, so an unchanged one must be told from one it made or changed.
   */
  baseline: Record<string, string>;
}

export function selectLabSnapshot(all: SnapshotFile[]): LabSnapshot {
  const files = selectParcelFiles(all);
  const binaries: SnapshotFile[] = [];
  const skipped: string[] = [];
  let total = 0;

  for (const file of all) {
    if (
      isExcludedPath(file.path) ||
      file.bytes.length === 0 ||
      isText(file.bytes)
    )
      continue;

    if (file.bytes.length > LAB_MAX_BINARY_FILE_BYTES) {
      skipped.push(
        `${file.path} (${Math.round(file.bytes.length / 1024 / 1024)} МБ — больше ${LAB_MAX_BINARY_FILE_BYTES / 1024 / 1024} МБ)`,
      );
    } else if (total + file.bytes.length > LAB_MAX_BINARY_TOTAL_BYTES) {
      skipped.push(
        `${file.path} (общий размер вложений превысил ${LAB_MAX_BINARY_TOTAL_BYTES / 1024 / 1024} МБ)`,
      );
    } else {
      total += file.bytes.length;
      binaries.push(file);
    }
  }

  const baseline = snapshotBaseline(files);

  for (const file of binaries)
    baseline[`${ASSET_PREFIX}${file.path}`] = sha256(file.bytes);

  return { files, binaries, skipped, baseline };
}

/** What goes into the parcel: the text files, and the binaries as assets. */
export function parcelEntries(snapshot: LabSnapshot): SnapshotFile[] {
  return [
    ...snapshot.files,
    ...snapshot.binaries.map((file) => ({
      path: `${ASSET_PREFIX}${file.path}`,
      bytes: file.bytes,
    })),
  ];
}

/** The task text for the worker, with a note on the binary files that did not fit. */
export function taskWithSkipped(task: string, skipped: string[]): string {
  if (skipped.length === 0) return task;

  const shown = skipped.slice(0, 20);

  return `${task}\n\nNote: these binary files of the repository exist but were NOT included here (too large): ${shown.join('; ')}${skipped.length > shown.length ? `; and ${skipped.length - shown.length} more` : ''}.`;
}

// path → hash of the text files, and of the binaries (prefix stripped), from the baseline stored with a run.
export function splitBaseline(baseline: Record<string, string>): {
  text: Record<string, string>;
  binaries: Record<string, string>;
} {
  const text: Record<string, string> = {};
  const binaries: Record<string, string> = {};

  for (const [path, hash] of Object.entries(baseline)) {
    if (path.startsWith(ASSET_PREFIX))
      binaries[path.slice(ASSET_PREFIX.length)] = hash;
    else text[path] = hash;
  }

  return { text, binaries };
}

// The text changes, plus the binaries the worker made or changed as additions (a binary at an existing path replaces it). A binary
// whose hash is the one it was given with is not a change — the worker hands every asset back.
export function withBinaries(
  textChanges: Change[],
  binaries: Map<string, Uint8Array>,
  given: Record<string, string> = {},
): Change[] {
  const changed = [...binaries].filter(
    ([path, bytes]) => given[path] !== sha256(bytes),
  );
  const changedPaths = new Set(changed.map(([path]) => path));
  const changes = textChanges.filter(
    (change) => !changedPaths.has(change.path),
  );

  for (const [path, bytes] of changed)
    changes.push({ path, kind: 'added', bytes });

  return changes.sort((a, b) => a.path.localeCompare(b.path));
}
