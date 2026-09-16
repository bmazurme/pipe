import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import AdmZip from 'adm-zip';

import type { SyncManifest } from './types.js';

export const MANIFEST_ENTRY = '__sync_manifest__.json';

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

export function readAndTransform(
  projectPath: string,
  relPaths: string[],
  transform: (text: string) => string,
): PackedFile[] {
  return relPaths.map((relPath) => ({
    relPath,
    content: transform(readFileSync(path.join(projectPath, relPath), 'utf-8')),
  }));
}

export function buildArchive(project: string, files: PackedFile[]): { buffer: Buffer; manifest: SyncManifest } {
  const manifest: SyncManifest = {
    project,
    machine: os.hostname(),
    createdAt: new Date().toISOString(),
    contentHash: contentHash(files),
  };

  const zip = new AdmZip();
  for (const file of files) {
    zip.addFile(file.relPath, Buffer.from(file.content, 'utf-8'));
  }
  zip.addFile(MANIFEST_ENTRY, Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'));

  return { buffer: zip.toBuffer(), manifest };
}

export function extractArchive(buffer: Buffer): { files: PackedFile[]; manifest: SyncManifest } {
  const zip = new AdmZip(buffer);
  const files: PackedFile[] = [];
  let manifest: SyncManifest | undefined;

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;

    if (entry.entryName === MANIFEST_ENTRY) {
      manifest = JSON.parse(entry.getData().toString('utf-8')) as SyncManifest;
      continue;
    }

    files.push({ relPath: entry.entryName, content: entry.getData().toString('utf-8') });
  }

  if (!manifest) {
    throw new Error('Archive is missing __sync_manifest__.json — not a sync-cli package.');
  }

  return { files, manifest };
}
