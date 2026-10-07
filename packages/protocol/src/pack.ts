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
// Exported since sync's issuePack.ts reads a parcel's entries by hand
// (rather than through extractArchive below, to also handle a legacy
// no-issue-metadata manifest) and needs the exact same prefix to recognize
// asset entries.
export const ASSET_PREFIX = '__issue_assets__/';

// Code-unit order, not localeCompare: the latter depends on the runtime's
// ICU/locale data, so the same files could hash differently across machines.
function byRelPath(a: { relPath: string }, b: { relPath: string }): number {
  return a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0;
}

export function contentHash(files: PackedFile[], assets: PackedAsset[] = []): string {
  const hash = createHash('sha256');
  for (const file of [...files].sort(byRelPath)) {
    hash.update(file.relPath);
    hash.update('\0');
    hash.update(file.content);
    hash.update('\0');
  }
  for (const asset of [...assets].sort(byRelPath)) {
    hash.update(asset.relPath);
    hash.update('\0');
    hash.update(asset.base64);
    hash.update('\0');
  }
  return hash.digest('hex');
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

export function extractArchive<M extends BaseManifest>(
  buffer: Buffer,
  entryName: string,
): { files: PackedFile[]; assets: PackedAsset[]; manifest: M } {
  const zip = new AdmZip(buffer);
  const files: PackedFile[] = [];
  const assets: PackedAsset[] = [];
  let manifest: M | undefined;

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;

    if (entry.entryName === entryName) {
      manifest = JSON.parse(entry.getData().toString('utf-8')) as M;
      continue;
    }

    if (entry.entryName.startsWith(ASSET_PREFIX)) {
      assets.push({
        relPath: entry.entryName.slice(ASSET_PREFIX.length),
        base64: entry.getData().toString('base64'),
      });
      continue;
    }

    files.push({ relPath: entry.entryName, content: entry.getData().toString('utf-8') });
  }

  if (!manifest) {
    throw new Error(`Archive is missing ${entryName} — not a recognized parcel.`);
  }

  assertSchemaVersion(manifest, entryName);

  return { files, assets, manifest };
}
