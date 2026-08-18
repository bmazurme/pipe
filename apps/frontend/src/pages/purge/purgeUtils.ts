import { PurgeEntry } from '../../store/api';

export type Direction = 'keyToValue' | 'valueToKey';

const SUGGESTION_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function randomToken(length: number): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result +=
      SUGGESTION_ALPHABET[Math.floor(Math.random() * SUGGESTION_ALPHABET.length)];
  }
  return result;
}

// Same length as the key, retried a few times against the values already in
// use so the suggestion is unique out of the box — the user can still type
// over it before submitting.
export function suggestUniqueValue(length: number, taken: Set<string>): string {
  if (length <= 0) return '';

  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = randomToken(length);
    if (!taken.has(candidate)) return candidate;
  }

  return randomToken(length);
}

export function buildDictionary(
  entries: PurgeEntry[],
  direction: Direction,
): Map<string, string> {
  const map = new Map<string, string>();

  for (const entry of entries) {
    const [from, to] =
      direction === 'keyToValue'
        ? [entry.key, entry.value]
        : [entry.value, entry.key];

    if (from && !map.has(from)) {
      map.set(from, to);
    }
  }

  return map;
}

export function applyDictionary(
  text: string,
  dictionary: Map<string, string>,
): { result: string; count: number } {
  if (!dictionary.size || !text) {
    return { result: text, count: 0 };
  }

  // Longest terms first so a multi-word key matches before a shorter one
  // that happens to be its prefix. Plain \b only recognizes ASCII word
  // characters, so it never finds a boundary around Cyrillic text — the
  // \p{L}/\p{N} lookaround below works for any script.
  const terms = [...dictionary.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])(${terms.join('|')})(?![\\p{L}\\p{N}_])`,
    'gu',
  );

  let count = 0;
  const result = text.replace(pattern, (match) => {
    count += 1;
    return dictionary.get(match) ?? match;
  });

  return { result, count };
}

export interface ImportedEntry {
  key: string;
  value: string;
}

// Matches the file format used by the ntlstl/purge desktop app (a plain
// JSON array of { key, value }, no envelope) so a dictionary exported from
// either app can be imported into the other. That app only requires a
// non-empty `key` — `value` can be missing/empty — so entries are validated
// the same way here; an empty value just won't survive createEntry (the
// backend requires one), which the import loop already reports as skipped.
export function parseImportedEntries(raw: string): ImportedEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Файл повреждён или не является корректным JSON');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Файл должен содержать массив пар { key, value }');
  }

  const entries = parsed.map((item, index) => {
    const key = (item as { key?: unknown } | null)?.key;
    if (typeof key !== 'string' || !key.trim()) {
      throw new Error(`Запись №${index + 1}: отсутствует или пустой "key"`);
    }

    const value = (item as { value?: unknown } | null)?.value;
    return {
      key: key.trim(),
      value: typeof value === 'string' ? value.trim() : String(value ?? ''),
    };
  });

  if (entries.length === 0) {
    throw new Error('Файл не содержит ни одной пары');
  }

  return entries;
}

// Same length as the real text (like a browser password field) so the row
// still hints at content shape without revealing it.
export function mask(value: string): string {
  return '•'.repeat(Math.min(value.length, 40));
}
