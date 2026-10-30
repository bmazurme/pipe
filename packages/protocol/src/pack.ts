import { createHash } from 'node:crypto';

import AdmZip from 'adm-zip';

import { assertSchemaVersion, PROTOCOL_SCHEMA_VERSION, type BaseManifest } from './manifest.js';

export interface PackedFile {
  relPath: string;
  content: string;
}

// Binary content (e.g. images pulled from a GitLab issue description) can't
// travel through PackedFile.content: that's always read/written as UTF-8
// text (see buildArchive/extractArchive below), which corrupts arbitrary
// bytes. Assets are zipped under a reserved prefix instead, going straight
// from base64 to a Buffer with no lossy string round-trip in between.
export interface PackedAsset {
  relPath: string;
  base64: string;
}

// Reserved — nothing under this prefix in a real project tree collides with
// it (double-underscore, matches the __*_manifest__.json convention).
export const ASSET_PREFIX = '__issue_assets__/';

// Code-unit order, not localeCompare: the latter depends on the runtime's
// ICU/locale data, so the same files could hash differently across machines.
function byRelPath(a: { relPath: string }, b: { relPath: string }): number {
  return a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0;
}

function hashEntries(files: PackedFile[], assets: PackedAsset[], compare: typeof byRelPath): string {
  const hash = createHash('sha256');
  for (const file of [...files].sort(compare)) {
    hash.update(file.relPath);
    hash.update('\0');
    hash.update(file.content);
    hash.update('\0');
  }
  for (const asset of [...assets].sort(compare)) {
    hash.update(asset.relPath);
    hash.update('\0');
    hash.update(asset.base64);
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function contentHash(files: PackedFile[], assets: PackedAsset[] = []): string {
  return hashEntries(files, assets, byRelPath);
}

// Parcels built before the comparator became code-unit order (< #34) sorted with
// localeCompare. A sender still running that build (a reports server that was not
// restarted, an older sync-cli) produces a hash a current reader would reject as
// tampered, though nothing is wrong with the parcel. Accept it on the read side
// only; drop once every sender is known to be past the switch.
function legacyContentHash(files: PackedFile[], assets: PackedAsset[]): string {
  return hashEntries(files, assets, (a, b) => a.relPath.localeCompare(b.relPath));
}

// Generic over the manifest shape so sync's project-mode manifest
// (__sync_manifest__.json) and issue-mode/reports' manifest
// (__subscription_manifest__.json) can each parameterize this with their own
// fields while sharing the zip/hash/schemaVersion mechanics.
export function buildArchive<M extends BaseManifest>(
  entryName: string,
  files: PackedFile[],
  manifestFields: Omit<M, 'schemaVersion' | 'contentHash'>,
  assets: PackedAsset[] = [],
): { buffer: Buffer; manifest: M } {
  const manifest = {
    ...manifestFields,
    schemaVersion: PROTOCOL_SCHEMA_VERSION,
    contentHash: contentHash(files, assets),
  } as M;

  const zip = new AdmZip();
  for (const file of files) {
    zip.addFile(file.relPath, Buffer.from(file.content, 'utf-8'));
  }
  for (const asset of assets) {
    zip.addFile(`${ASSET_PREFIX}${asset.relPath}`, Buffer.from(asset.base64, 'base64'));
  }
  zip.addFile(entryName, Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'));

  return { buffer: zip.toBuffer(), manifest };
}

export interface ParcelLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
}

// Parcels arrive from bridge storage, so a reader must not inflate whatever
// the zip claims: generous caps, far above any real project tree.
export const DEFAULT_PARCEL_LIMITS: ParcelLimits = {
  maxEntries: 20_000,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
};

export function extractArchive<M extends BaseManifest>(
  buffer: Buffer,
  entryName: string,
  limits: Partial<ParcelLimits> = {},
): { files: PackedFile[]; assets: PackedAsset[]; manifest: M } {
  const { maxEntries, maxEntryBytes, maxTotalBytes } = { ...DEFAULT_PARCEL_LIMITS, ...limits };
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  if (entries.length > maxEntries) {
    throw new Error(`Parcel exceeds the entry limit (${entries.length} > ${maxEntries})`);
  }
  for (const entry of entries) {
    if (!entry.isDirectory && entry.header.size > maxEntryBytes) {
      throw new Error(
        `Parcel exceeds the per-entry size limit (${entry.entryName}: ${entry.header.size} > ${maxEntryBytes} bytes)`,
      );
    }
  }
  let totalBytes = 0;
  // The declared size can lie, so the real inflated length is checked too.
  const inflate = (entry: (typeof entries)[number]): Buffer => {
    const data = entry.getData();
    totalBytes += data.length;
    if (data.length > maxEntryBytes) {
      throw new Error(
        `Parcel exceeds the per-entry size limit (${entry.entryName}: ${data.length} > ${maxEntryBytes} bytes)`,
      );
    }
    if (totalBytes > maxTotalBytes) {
      throw new Error(`Parcel exceeds the total size limit (> ${maxTotalBytes} bytes)`);
    }
    return data;
  };
  const files: PackedFile[] = [];
  const assets: PackedAsset[] = [];
  let manifest: M | undefined;

  for (const entry of entries) {
    if (entry.isDirectory) continue;

    if (entry.entryName === entryName) {
      manifest = JSON.parse(inflate(entry).toString('utf-8')) as M;
      continue;
    }

    if (entry.entryName.startsWith(ASSET_PREFIX)) {
      assets.push({
        relPath: entry.entryName.slice(ASSET_PREFIX.length),
        base64: inflate(entry).toString('base64'),
      });
      continue;
    }

    files.push({ relPath: entry.entryName, content: inflate(entry).toString('utf-8') });
  }

  if (!manifest) {
    throw new Error(`Archive is missing ${entryName} — not a recognized parcel.`);
  }

  assertSchemaVersion(manifest, entryName);

  // Pre-hash parcels carry no contentHash — skip silently rather than reject them.
  if (
    typeof manifest.contentHash === 'string' &&
    manifest.contentHash !== contentHash(files, assets) &&
    manifest.contentHash !== legacyContentHash(files, assets)
  ) {
    throw new Error(`Parcel ${entryName} failed integrity check: contentHash mismatch`);
  }

  return { files, assets, manifest };
}
