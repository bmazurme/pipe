import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { PackedAsset, PackedFile } from '@pipe/protocol';

import { EXCLUDED_RESULT_DIRS, listFilesRecursively } from './fsWalk.js';
import type { ExtractedParcel } from './parcel.js';
import { resolveInDir } from './resolveInDir.js';

function isExcludedResultPath(relPath: string): boolean {
  return relPath.split(/[\\/]/).some((segment) => EXCLUDED_RESULT_DIRS.has(segment));
}

function decodeUtf8Strict(bytes: Buffer): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

// Lays the parcel's text files and binary assets out in the job directory.
export function writeParcelToDir(dir: string, parcel: ExtractedParcel): void {
  const entries: { relPath: string; data: string | Buffer }[] = [
    ...parcel.files.map((file) => ({ relPath: file.relPath, data: file.content })),
    ...parcel.assets.map((asset) => ({ relPath: asset.relPath, data: Buffer.from(asset.base64, 'base64') })),
  ];
  for (const { relPath, data } of entries) {
    const destination = resolveInDir(dir, relPath);
    mkdirSync(path.dirname(destination), { recursive: true });
    if (typeof data === 'string') writeFileSync(destination, data, 'utf-8');
    else writeFileSync(destination, data);
  }
}

// Re-reads every file currently on disk (covers edits AND new files the
// model created) as the result's file set. Original assets are kept
// exactly as extracted. Files that aren't valid UTF-8 (images, archives,
// compiled output) can't go through PackedFile's text content without
// corruption, so they travel as assets (raw bytes -> base64). Tool state
// dirs (.claude/, node_modules/) are never part of the result.
export function collectResult(dir: string, parcel: ExtractedParcel): { files: PackedFile[]; assets: PackedAsset[] } {
  const assetPaths = new Set(parcel.assets.map((asset) => asset.relPath));
  const files: PackedFile[] = [];
  const assets: PackedAsset[] = [...parcel.assets];
  for (const relPath of listFilesRecursively(dir, dir, EXCLUDED_RESULT_DIRS)) {
    if (assetPaths.has(relPath) || isExcludedResultPath(relPath)) continue;
    const bytes = readFileSync(path.join(dir, relPath));
    const text = decodeUtf8Strict(bytes);
    if (text === undefined) assets.push({ relPath, base64: bytes.toString('base64') });
    else files.push({ relPath, content: text });
  }
  return { files, assets };
}
