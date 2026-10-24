import {
  type SnapshotFile,
  unzipBounded,
  type UnzipLimits,
} from '../common/zip';
import {
  ASSET_PREFIX,
  Change,
  isExcludedPath,
  MANIFEST_ENTRY,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  selectParcelFiles,
  sha256,
  snapshotBaseline,
} from '../improve/parcel';

// Lab, unlike Improve, publishes what a worker made as it is — drawings, images and other binaries included. The worker sends the
// files that are not valid UTF-8 as `__issue_assets__/` entries; Improve drops them on purpose (its results are text), Lab keeps them.
// The binaries of the repository go to the worker as assets too (see selectLabSnapshot) and come back with the rest, so an entry is
// a change only when its hash differs from the one it was given with.
export const LAB_MAX_CHANGED_FILES = 200;
export const LAB_MAX_CHANGED_BYTES = 50 * 1024 * 1024;

// A worker writes this file to ask bridge to open a GitHub Issue instead of, or alongside, a pull request — Lab's only
// output channel otherwise. lab-publish.service.ts reads and removes it; it is never committed to the repository.
export const ISSUE_MARKER_PATH = '.lab/issue.json';

export interface LabResult {
  /** Text files left on disk (edited, new, untouched), by path. */
  files: Map<string, Uint8Array>;
  /** Binary files the worker made, by path. */
  binaries: Map<string, Uint8Array>;
}

export async function readLabResult(
  data: Uint8Array,
  limits: UnzipLimits = LAB_RESULT_UNZIP_LIMITS,
): Promise<LabResult> {
  const files = new Map<string, Uint8Array>();
  const binaries = new Map<string, Uint8Array>();

  for (const [name, bytes] of Object.entries(
    await unzipBounded(data, limits),
  )) {
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

// Decides which files of the repository archive are worth inflating at all — BEFORE they are inflated, from the sizes its headers
// declare: a repository of a hundred binaries must not be unpacked whole only to throw most of it away (that took bridge over its
// memory limit). A file up to the size of a text file is taken; a bigger one can only be a binary and is taken within the limits of
// one file and of all of them; the rest is named in `skipped`. `accept` is for readZipball.
export const LAB_MAX_UNPACKED_BYTES = 80 * 1024 * 1024;

export function labZipFilter(): {
  accept: (path: string, size: number) => boolean;
  skipped: string[];
} {
  const skipped: string[] = [];
  let total = 0;
  let large = 0;

  return {
    skipped,
    accept: (path, size) => {
      if (isExcludedPath(path) || size === 0) return false;

      if (size > MAX_FILE_BYTES) {
        if (size > LAB_MAX_BINARY_FILE_BYTES) {
          skipped.push(
            `${path} (${Math.round(size / 1024 / 1024)} МБ — больше ${LAB_MAX_BINARY_FILE_BYTES / 1024 / 1024} МБ)`,
          );

          return false;
        }
        if (large + size > LAB_MAX_BINARY_TOTAL_BYTES) {
          skipped.push(
            `${path} (общий размер вложений превысил ${LAB_MAX_BINARY_TOTAL_BYTES / 1024 / 1024} МБ)`,
          );

          return false;
        }

        large += size;
      }

      // A bound on everything taken, small files included: the number of files is not.
      if (total + size > LAB_MAX_UNPACKED_BYTES) {
        skipped.push(`${path} (репозиторий слишком большой для передачи)`);

        return false;
      }

      total += size;

      return true;
    },
  };
}

export function selectLabSnapshot(
  all: SnapshotFile[],
  alreadySkipped: string[] = [],
): LabSnapshot {
  const files = selectParcelFiles(all);
  const binaries: SnapshotFile[] = [];
  const skipped: string[] = [...alreadySkipped];
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

// What the worker is told about the place it works in. Without it a model finds a folder with no .git in front of a private repository
// and asks who clones it and how to commit (it did: "Этап 0 ... Кто делает clone?"), then waits for an answer nobody gives during a run.
export function labEnvironment(repo: string, baseBranch: string): string {
  return [
    'About where you work (Lab):',
    `- The working directory is a snapshot of the repository ${repo} (branch ${baseBranch}) WITHOUT .git. The repository is private and access to it is already arranged: do not clone it, and do not ask who does.`,
    '- Do not commit, push, create branches or open pull requests, and do not look for credentials for it. When you finish, bridge publishes every file you created or changed (text and binary; not `.github/workflows/` and `.git/`) as a branch and a pull request in that repository, which the owner reviews and merges. Just leave the files in the working directory, in the places the project describes (for example calc/ and cad/).',
    `- If the task specifically asks to open a GitHub Issue (to track or report something) rather than change files, write exactly one file at \`${ISSUE_MARKER_PATH}\` with JSON \`{"title": "...", "body": "..."}\`: bridge opens that Issue for you and never commits this file. Use it only for that — not as a way to leave yourself a note, and not together with unrelated file changes.`,
    '- Nobody can answer a question during the run. If something is unclear or missing, make the most reasonable assumption, say so where the project keeps its decisions and open questions (its documents), and carry on with everything that does not depend on it. A question only blocks the part that really needs the answer, never the whole run.',
  ].join('\n');
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

// The text changes, plus what happened to the binaries:
//  - one the worker made or changed is an addition (a binary at an existing path replaces it); one whose hash is the one it was
//    given with is not a change;
//  - one the repository had (it was given to the worker) and the result no longer has is a DELETION — the worker now returns what
//    is on its disk, so a file it removed is simply missing. `textPaths` are the text files of the result: a binary that came back
//    as text is a change of that file, not a deletion. (A worker from before that returned every binary it was given, even a removed
//    one: nothing is missing from such a result, so nothing is deleted.)
export function withBinaries(
  textChanges: Change[],
  binaries: Map<string, Uint8Array>,
  given: Record<string, string> = {},
  textPaths: ReadonlySet<string> = new Set(),
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

  for (const path of Object.keys(given)) {
    if (!binaries.has(path) && !textPaths.has(path)) {
      changes.push({ path, kind: 'deleted' });
    }
  }

  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

// The text snapshot that was sent, plus the changes and the binaries; one entry is a binary at most.
export const LAB_RESULT_UNZIP_LIMITS: UnzipLimits = {
  maxEntries: 10000,
  maxEntryBytes: LAB_MAX_BINARY_FILE_BYTES,
  maxTotalBytes:
    MAX_TOTAL_BYTES + LAB_MAX_CHANGED_BYTES + LAB_MAX_BINARY_TOTAL_BYTES,
};
