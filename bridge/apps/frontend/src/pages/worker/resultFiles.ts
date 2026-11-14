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

// Same rules as readResultText, applied to the source parcel.
export function readSourceText(sourceBytes: Uint8Array, path: string): string | null {
  return readResultText(sourceBytes, path);
}

export const MAX_DIFF_LINES = 3000;
const DIFF_CONTEXT = 3;

export interface DiffLine {
  kind: ' ' | '+' | '-';
  text: string;
}

// Line diff via LCS; null when either side is over MAX_DIFF_LINES. Unchanged runs longer than
// 2 * DIFF_CONTEXT are cut to DIFF_CONTEXT lines on each side of a change, with a '…' marker.
export function lineDiff(before: string, after: string): DiffLine[] | null {
  const a = before.split('\n');
  const b = after.split('\n');

  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) return null;

  let start = 0;

  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;

  let endA = a.length;
  let endB = b.length;

  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  const n = endA - start;
  const m = endB - start;
  const width = m + 1;
  const table = new Uint16Array((n + 1) * width);

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[start + i] === b[start + j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  const all: DiffLine[] = [];

  for (let i = 0; i < start; i += 1) all.push({ kind: ' ', text: a[i] });

  let i = 0;
  let j = 0;

  while (i < n || j < m) {
    if (i < n && j < m && a[start + i] === b[start + j]) {
      all.push({ kind: ' ', text: a[start + i] });
      i += 1;
      j += 1;
    } else if (i < n && (j >= m || table[(i + 1) * width + j] >= table[i * width + j + 1])) {
      all.push({ kind: '-', text: a[start + i] });
      i += 1;
    } else {
      all.push({ kind: '+', text: b[start + j] });
      j += 1;
    }
  }

  for (let k = endA; k < a.length; k += 1) all.push({ kind: ' ', text: a[k] });

  const out: DiffLine[] = [];
  let k = 0;

  while (k < all.length) {
    if (all[k].kind !== ' ') {
      out.push(all[k]);
      k += 1;
      continue;
    }

    let end = k;

    while (end < all.length && all[end].kind === ' ') end += 1;

    const run = all.slice(k, end);
    const head = k === 0 ? 0 : DIFF_CONTEXT;
    const tail = end === all.length ? 0 : DIFF_CONTEXT;

    if (run.length > head + tail + 1) {
      out.push(...run.slice(0, head), { kind: ' ', text: '…' }, ...run.slice(run.length - tail));
    } else {
      out.push(...run);
    }

    k = end;
  }

  return out;
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
