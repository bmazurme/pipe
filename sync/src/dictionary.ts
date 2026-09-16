import { readFileSync, existsSync } from 'node:fs';

import { applyDictionary as applySubstitution } from '@pipe/protocol';

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

// Projects with no dictionary configured (agent-runner's whole point — see
// README "agent-runner") get a no-op dictionary: toRemote/toLocal both
// become identity, content passes through unchanged.
export function loadOptionalDictionary(dictionaryRef: string | undefined): Dictionary {
  return dictionaryRef ? loadDictionary(dictionaryRef) : {};
}

// push direction: real value (key) -> placeholder (value), before it leaves this machine.
// Matches Purge's own convention — you type the real term as "key" and it
// suggests a same-length random "value" as the placeholder. The actual
// longest-first, Unicode-boundary substitution lives in @pipe/protocol,
// shared with reports and bridge (see that package for the algorithm).
export function toRemote(dictionary: Dictionary, text: string): string {
  return applySubstitution(text, new Map(Object.entries(dictionary))).result;
}

// pull direction: placeholder (value) -> real value (key), after it arrives.
export function toLocal(dictionary: Dictionary, text: string): string {
  return applySubstitution(text, new Map(Object.entries(dictionary).map(([key, value]) => [value, key]))).result;
}
