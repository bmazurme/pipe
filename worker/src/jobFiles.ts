import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { PackedAsset, PackedFile } from '@pipe/protocol';

import { EXCLUDED_RESULT_DIRS, listFilesRecursively } from './fsWalk.js';
import type { ExtractedParcel } from './parcel.js';
import { resolveInDir } from '@pipe/protocol/resolveInDir';

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

// Re-reads every file currently on disk as the result's file set: edits, new files the model created — and the binary assets the
// parcel brought too. What the result says about a file is what is on the disk NOW: a drawing the model regenerated comes back
// as the new version (it used to come back as the one the parcel brought, so the update was lost), and a file the model deleted
// is simply not there (it used to be returned all the same, so the deletion was lost). Files that aren't valid UTF-8 (images,
// archives, compiled output) can't go through PackedFile's text content without corruption, so they travel as assets (raw
// bytes -> base64). Tool state dirs (.claude/, node_modules/) are never part of the result.
export function collectResult(
  dir: string,
  redact?: (text: string) => string,
  log?: (message: string) => void,
): { files: PackedFile[]; assets: PackedAsset[] } {
  const files: PackedFile[] = [];
  const assets: PackedAsset[] = [];
  for (const relPath of listFilesRecursively(dir, dir, EXCLUDED_RESULT_DIRS)) {
    if (isExcludedResultPath(relPath)) continue;
    const bytes = readFileSync(path.join(dir, relPath));
    const text = decodeUtf8Strict(bytes);
    if (text === undefined) assets.push({ relPath, base64: bytes.toString('base64') });
    else {
      const masked = redact ? redact(text) : text;
      if (masked !== text) log?.(`Masked a credential in ${relPath}\n`);
      files.push({ relPath, content: masked });
    }
  }
  return { files, assets };
}

// Paths the run added or modified relative to the parcel it was given (sorted). Content only decides "modified"; it is never returned.
export function changedFiles(
  parcel: Pick<ExtractedParcel, 'files' | 'assets'>,
  collected: { files: PackedFile[]; assets: PackedAsset[] },
): string[] {
  const before = new Map<string, string>();
  for (const file of parcel.files) before.set(file.relPath, `t:${file.content}`);
  for (const asset of parcel.assets) before.set(asset.relPath, `b:${asset.base64}`);
  const changed: string[] = [];
  for (const file of collected.files) if (before.get(file.relPath) !== `t:${file.content}`) changed.push(file.relPath);
  for (const asset of collected.assets) if (before.get(asset.relPath) !== `b:${asset.base64}`) changed.push(asset.relPath);
  return changed.sort();
}

const MAX_LISTED_CHANGED_FILES = 20;

export function describeChangedFiles(names: string[]): string {
  if (names.length === 0) return 'Before the time limit the run left no files changed\n';
  const shown = names.slice(0, MAX_LISTED_CHANGED_FILES).join(', ');
  const more = names.length > MAX_LISTED_CHANGED_FILES ? `, … (+${names.length - MAX_LISTED_CHANGED_FILES} more)` : '';
  return `Before the time limit the run had changed ${names.length} files: ${shown}${more}\n`;
}
