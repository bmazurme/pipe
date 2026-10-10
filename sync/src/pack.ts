import { readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  buildArchive as buildArchiveGeneric,
  extractArchive as extractArchiveGeneric,
  contentHash,
  SYNC_MANIFEST_ENTRY,
  type PackedFile,
} from '@pipe/protocol';

import type { SyncManifest } from './types.js';

export const MANIFEST_ENTRY = SYNC_MANIFEST_ENTRY;

export type { PackedFile };
export { contentHash };

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
  return buildArchiveGeneric<SyncManifest>(MANIFEST_ENTRY, files, {
    project,
    machine: os.hostname(),
    createdAt: new Date().toISOString(),
  });
}

export function extractArchive(buffer: Buffer): { files: PackedFile[]; manifest: SyncManifest } {
  return extractArchiveGeneric<SyncManifest>(buffer, MANIFEST_ENTRY);
}
