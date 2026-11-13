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

export type FileChange = 'added' | 'modified' | 'unchanged';

export interface ComparedFile extends ResultFile {
  change: FileChange;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }

  return true;
}

// Byte-compares the result tree with the source parcel it was produced from; throws when either is not a zip.
export function compareWithSource(result: Uint8Array, source: Uint8Array): { files: ComparedFile[]; deleted: string[] } {
  const filter = (file: { name: string }) => isListed(file.name);
  const after = unzipSync(result, { filter });
  const before = unzipSync(source, { filter });
  const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

  const files = Object.keys(after)
    .sort(byPath)
    .map((path): ComparedFile => {
      const data = after[path];
      const old = before[path];
      const change: FileChange = !old ? 'added' : sameBytes(old, data) ? 'unchanged' : 'modified';

      return { path, size: data.length, change };
    });
  const deleted = Object.keys(before)
    .filter((path) => !(path in after))
    .sort(byPath);

  return { files, deleted };
}
