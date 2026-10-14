import { createHash } from 'crypto';

import {
  strFromU8,
  strToU8,
  unzip,
  zip,
  type Unzipped,
  type Zippable,
} from 'fflate';

// Builds the parcel a worker job consumes from a repository snapshot, and reads
// the worker's result parcel back. Same on-the-wire shape as reports' Subscription
// parcels (a zip of text files plus __subscription_manifest__.json carrying the
// issue), minus the contentHash/dictionary: this runs inside bridge on a public
// repository, so there is nothing to anonymize and no second machine to verify
// integrity against. The worker treats a parcel without a hash as a legacy one.
// Only those two are left out: the manifest is still stamped with a schemaVersion.

// Mirrors PROTOCOL_SCHEMA_VERSION in packages/protocol/src/manifest.ts; the backend
// deliberately does not depend on @pipe/protocol (parcel.spec.ts guards against drift).
export const PARCEL_SCHEMA_VERSION = 2;

export const MANIFEST_ENTRY = '__subscription_manifest__.json';
export const ASSET_PREFIX = '__issue_assets__/';

const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 15 * 1024 * 1024;
const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.next',
  '.cache',
  '__pycache__',
]);
const EXCLUDED_FILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
]);

// Generated or vendored output (build info too: a committed .tsbuildinfo makes `tsc -b` skip emitting in CI) and lockfiles is never part of the snapshot, so it can never be part of a change
// either: a worker that builds before finishing leaves dist/ and friends in its result.
export function isExcludedPath(path: string): boolean {
  const segments = path.split('/');

  return (
    segments.slice(0, -1).some((segment) => EXCLUDED_DIRS.has(segment)) ||
    EXCLUDED_FILES.has(segments[segments.length - 1]) ||
    segments[segments.length - 1].endsWith('.tsbuildinfo')
  );
}

export const MAX_CHANGED_FILES = 100;
export const MAX_CHANGED_BYTES = 3 * 1024 * 1024;

const utf8 = new TextDecoder('utf-8', { fatal: true });

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// fflate's callback forms run on worker threads in Node, so large archives do
// not block bridge's event loop.
function unzipAsync(data: Uint8Array): Promise<Unzipped> {
  return new Promise((resolve, reject) => {
    unzip(data, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

// A parcel is a short-lived transfer artifact: speed matters more than ratio.
function zipAsync(entries: Zippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(entries, { level: 1 }, (err, out) =>
      err ? reject(err) : resolve(out),
    );
  });
}

export interface SnapshotFile {
  path: string;
  bytes: Uint8Array;
}

// A repository zipball has one top-level folder ("owner-repo-<sha>/"); strip it.
export async function readZipball(data: Uint8Array): Promise<SnapshotFile[]> {
  const entries = await unzipAsync(data);
  const files: SnapshotFile[] = [];

  for (const [name, bytes] of Object.entries(entries)) {
    if (name.endsWith('/')) continue;

    const path = name.split('/').slice(1).join('/');

    if (path) files.push({ path, bytes });
  }

  return files;
}

function isText(bytes: Uint8Array): boolean {
  try {
    utf8.decode(bytes);

    return true;
  } catch {
    return false;
  }
}

// What the model gets to see: source and docs, not vendored or generated files,
// lockfiles, big files or binaries. Whatever is left out cannot be changed by the
// run either, which is also why the diff below is against exactly this set.
export function selectParcelFiles(files: SnapshotFile[]): SnapshotFile[] {
  const selected: SnapshotFile[] = [];
  let total = 0;

  for (const file of files) {
    if (isExcludedPath(file.path)) continue;
    if (file.bytes.length > MAX_FILE_BYTES || !isText(file.bytes)) continue;

    total += file.bytes.length;

    if (total > MAX_TOTAL_BYTES) {
      throw new Error(
        `The repository is too large to hand to a worker (over ${MAX_TOTAL_BYTES / 1024 / 1024} MB of text)`,
      );
    }

    selected.push(file);
  }

  return selected;
}

export interface IssueRef {
  number: number | string;
  title: string;
  body: string;
  repo: string;
  baseBranch: string;
}

export interface BuiltParcel {
  buffer: Buffer;
  /** path → sha256 of every file handed to the worker; the baseline for the diff. */
  baseline: Record<string, string>;
}

// path → sha256 of every snapshot file. It depends only on the snapshot, so
// several launches on one base SHA can hash it once and pass it in.
export function snapshotBaseline(
  files: SnapshotFile[],
): Record<string, string> {
  const baseline: Record<string, string> = {};
  for (const file of files) {
    baseline[file.path] = sha256(file.bytes);
  }
  return baseline;
}

export async function buildIssueParcel(
  files: SnapshotFile[],
  issue: IssueRef,
  now = new Date(),
  baseline: Record<string, string> = snapshotBaseline(files),
): Promise<BuiltParcel> {
  const entries: Record<string, Uint8Array> = {};

  for (const file of files) {
    entries[file.path] = file.bytes;
  }

  entries[MANIFEST_ENTRY] = strToU8(
    JSON.stringify(
      {
        schemaVersion: PARCEL_SCHEMA_VERSION,
        issueId: String(issue.number),
        issueIid: String(issue.number),
        issueTitle: issue.title,
        issueDescription: issue.body,
        projectId: 0,
        branch: issue.baseBranch,
        createdAt: now.toISOString(),
        source: `github:${issue.repo}`,
      },
      null,
      2,
    ),
  );

  return { buffer: Buffer.from(await zipAsync(entries)), baseline };
}

// The worker's result: every text file left on disk (edited, new, untouched), the
// binaries as __issue_assets__/ entries, and the manifest. Only the text files can
// be a change we publish.
export async function readResultParcel(
  data: Uint8Array,
): Promise<Map<string, Uint8Array>> {
  const result = new Map<string, Uint8Array>();

  for (const [name, bytes] of Object.entries(await unzipAsync(data))) {
    if (
      name.endsWith('/') ||
      name === MANIFEST_ENTRY ||
      name.startsWith(ASSET_PREFIX) ||
      isExcludedPath(name)
    )
      continue;

    result.set(name, bytes);
  }

  return result;
}

export interface Change {
  path: string;
  kind: 'modified' | 'added' | 'deleted';
  bytes?: Uint8Array;
}

// Against the baseline of what the worker was given. A file missing from the result
// is a deletion only if it was in the baseline (the model removed it).
export function diffResult(
  baseline: Record<string, string>,
  result: Map<string, Uint8Array>,
): Change[] {
  const changes: Change[] = [];

  for (const [path, bytes] of result) {
    if (!(path in baseline)) changes.push({ path, kind: 'added', bytes });
    else if (baseline[path] !== sha256(bytes))
      changes.push({ path, kind: 'modified', bytes });
  }

  for (const path of Object.keys(baseline)) {
    if (!result.has(path)) changes.push({ path, kind: 'deleted' });
  }

  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

export function describeChanges(changes: Change[]): string {
  const count = (kind: Change['kind']) =>
    changes.filter((change) => change.kind === kind).length;

  return `${count('modified')} изменено, ${count('added')} добавлено, ${count('deleted')} удалено`;
}

export function utf8Text(bytes: Uint8Array): string {
  return strFromU8(bytes);
}
