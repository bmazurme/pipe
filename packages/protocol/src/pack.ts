import { createHash } from 'node:crypto';

import AdmZip from 'adm-zip';

import { assertSchemaVersion, PROTOCOL_SCHEMA_VERSION, type BaseManifest } from './manifest.js';

export interface PackedFile {
  relPath: string;
  content: string;
}

export function contentHash(files: PackedFile[]): string {
  const hash = createHash('sha256');
  for (const file of [...files].sort((a, b) => a.relPath.localeCompare(b.relPath))) {
    hash.update(file.relPath);
    hash.update('\0');
    hash.update(file.content);
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
): { buffer: Buffer; manifest: M } {
  const manifest = {
    ...manifestFields,
    schemaVersion: PROTOCOL_SCHEMA_VERSION,
    contentHash: contentHash(files),
  } as M;

  const zip = new AdmZip();
  for (const file of files) {
    zip.addFile(file.relPath, Buffer.from(file.content, 'utf-8'));
  }
  zip.addFile(entryName, Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'));

  return { buffer: zip.toBuffer(), manifest };
}

export function extractArchive<M extends BaseManifest>(
  buffer: Buffer,
  entryName: string,
): { files: PackedFile[]; manifest: M } {
  const zip = new AdmZip(buffer);
  const files: PackedFile[] = [];
  let manifest: M | undefined;

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;

    if (entry.entryName === entryName) {
      manifest = JSON.parse(entry.getData().toString('utf-8')) as M;
      continue;
    }

    files.push({ relPath: entry.entryName, content: entry.getData().toString('utf-8') });
  }

  if (!manifest) {
    throw new Error(`Archive is missing ${entryName} — not a recognized parcel.`);
  }

  assertSchemaVersion(manifest, entryName);

  return { files, manifest };
}
