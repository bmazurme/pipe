import { unzipSync } from 'fflate';

const MANIFEST_NAMES = new Set(['__sync_manifest__.json', '__subscription_manifest__.json']);

export const MAX_PREVIEW_BYTES = 200 * 1024;

export interface ResultFile {
  path: string;
  size: number;
}

// Directory entries (trailing slash) and the parcel manifest are not files the owner cares about.
function isListed(path: string): boolean {
  return !path.endsWith('/') && !MANIFEST_NAMES.has(path);
}

export function listResultFiles(bytes: Uint8Array): ResultFile[] {
  const entries = unzipSync(bytes, { filter: (file) => isListed(file.name) });

  return Object.entries(entries)
    .map(([path, data]) => ({ path, size: data.length }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function isMarkdownFile(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

// Null when the entry is missing, binary (has a NUL byte) or too big to show in place.
export function readResultText(bytes: Uint8Array, path: string): string | null {
  const entries = unzipSync(bytes, { filter: (file) => file.name === path });
  const data = entries[path];

  if (!data || data.length > MAX_PREVIEW_BYTES || data.includes(0)) return null;

  return new TextDecoder('utf-8').decode(data);
}
