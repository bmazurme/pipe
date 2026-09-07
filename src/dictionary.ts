import { readFileSync, existsSync } from 'node:fs';

import { resolveDictionaryPath } from './paths.js';

export type Dictionary = Record<string, string>;

export function loadDictionary(dictionaryRef: string): Dictionary {
  const path = resolveDictionaryPath(dictionaryRef);

  if (!existsSync(path)) {
    throw new Error(
      `Dictionary "${dictionaryRef}" not found at ${path}. Create it as a flat ` +
        '{ "PLACEHOLDER_KEY": "real value" } JSON file — it stays local to this machine.',
    );
  }

  return JSON.parse(readFileSync(path, 'utf-8')) as Dictionary;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Longest-first so a value/key that is a substring of another (e.g. "DB_HOST"
// vs "DB_HOST_PORT") never gets partially replaced first.
function buildReplacer(pairs: [needle: string, replacement: string][]): (text: string) => string {
  const nonEmpty = pairs.filter(([needle]) => needle.length > 0);

  if (nonEmpty.length === 0) {
    return (text) => text;
  }

  const sorted = [...nonEmpty].sort((a, b) => b[0].length - a[0].length);
  const pattern = new RegExp(sorted.map(([needle]) => escapeRegExp(needle)).join('|'), 'g');
  const replacementByNeedle = new Map(sorted);

  return (text: string) => text.replace(pattern, (match) => replacementByNeedle.get(match) ?? match);
}

// push direction: de-personalize before it leaves this machine.
export function toRemote(dictionary: Dictionary, text: string): string {
  const replacer = buildReplacer(Object.entries(dictionary).map(([key, value]) => [value, key]));
  return replacer(text);
}

// pull direction: re-personalize for this machine after it arrives.
export function toLocal(dictionary: Dictionary, text: string): string {
  const replacer = buildReplacer(Object.entries(dictionary));
  return replacer(text);
}
