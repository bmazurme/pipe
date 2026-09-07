import { readFileSync, existsSync } from 'node:fs';

import { resolveDictionaryPath } from './paths.js';

export type Dictionary = Record<string, string>;

interface PurgeExportEntry {
  key?: unknown;
  value?: unknown;
}

// bridge's Purge page (PurgeDictionaryTab.tsx "Экспорт" button) writes a
// plain JSON array of { key, value } — no envelope. Accepting that shape
// directly means a dictionary can be authored there and dropped in here
// unmodified. A flat { key: value } object is also accepted for hand-editing.
function parseDictionaryFile(raw: string, path: string): Dictionary {
  const parsed: unknown = JSON.parse(raw);

  if (Array.isArray(parsed)) {
    const dictionary: Dictionary = {};
    for (const entry of parsed as PurgeExportEntry[]) {
      if (typeof entry.key !== 'string' || !entry.key) continue;
      if (dictionary[entry.key] !== undefined) continue; // first wins, matches purgeUtils.buildDictionary
      dictionary[entry.key] = typeof entry.value === 'string' ? entry.value : '';
    }
    return dictionary;
  }

  if (parsed && typeof parsed === 'object') {
    return parsed as Dictionary;
  }

  throw new Error(
    `${path} must be either a Purge export (JSON array of { key, value }) or a flat { key: value } object.`,
  );
}

export function loadDictionary(dictionaryRef: string): Dictionary {
  const path = resolveDictionaryPath(dictionaryRef);

  if (!existsSync(path)) {
    throw new Error(
      `Dictionary "${dictionaryRef}" not found at ${path}. Export it from bridge's Purge page ` +
        '("Экспорт" button) and save it there, or create it by hand as { "KEY": "value" } — ' +
        'either way it stays local to this machine.',
    );
  }

  return parseDictionaryFile(readFileSync(path, 'utf-8'), path);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Mirrors bridge's own applyDictionary (apps/frontend/src/pages/purge/purgeUtils.ts):
// longest-first so a term that's a prefix of another never shadows it, and
// unicode-aware word boundaries so e.g. a key "id" doesn't match inside
// "userId" or "валидный".
function buildReplacer(pairs: [needle: string, replacement: string][]): (text: string) => string {
  const nonEmpty = pairs.filter(([needle]) => needle.length > 0);

  if (nonEmpty.length === 0) {
    return (text) => text;
  }

  const sorted = [...nonEmpty].sort((a, b) => b[0].length - a[0].length);
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])(${sorted.map(([needle]) => escapeRegExp(needle)).join('|')})(?![\\p{L}\\p{N}_])`,
    'gu',
  );
  const replacementByNeedle = new Map(sorted);

  return (text: string) => text.replace(pattern, (match) => replacementByNeedle.get(match) ?? match);
}

// push direction: real value (key) -> placeholder (value), before it leaves this machine.
// Matches Purge's own convention — you type the real term as "key" and it
// suggests a same-length random "value" as the placeholder.
export function toRemote(dictionary: Dictionary, text: string): string {
  const replacer = buildReplacer(Object.entries(dictionary));
  return replacer(text);
}

// pull direction: placeholder (value) -> real value (key), after it arrives.
export function toLocal(dictionary: Dictionary, text: string): string {
  const replacer = buildReplacer(Object.entries(dictionary).map(([key, value]) => [value, key]));
  return replacer(text);
}
