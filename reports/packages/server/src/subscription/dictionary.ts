import type { DictionaryEntryType } from '@reports/shared';
import { applyDictionary as applySubstitution } from '@pipe/protocol';

export type Direction = 'toRemote' | 'toLocal';

function buildMap(entries: DictionaryEntryType[], direction: Direction): Map<string, string> {
  const map = new Map<string, string>();

  for (const entry of entries) {
    const [from, to] = direction === 'toRemote' ? [entry.key, entry.value] : [entry.value, entry.key];

    if (from && !map.has(from)) {
      map.set(from, to);
    }
  }

  return map;
}

/**
 * Substitutes real values with placeholders (`toRemote`) or placeholders back
 * with real values (`toLocal`). The actual longest-first, Unicode-boundary
 * matching lives in @pipe/protocol, shared with sync's dictionary.ts and
 * bridge's purgeUtils.ts so a dictionary exported from either can be reused
 * here unchanged.
 */
export function applyDictionary(text: string, entries: DictionaryEntryType[], direction: Direction): string {
  return applySubstitution(text, buildMap(entries, direction)).result;
}

// Same substitution, but also reports how many replacements were made — for
// the reports-native Purge page, which shows that count the way bridge's
// own Purge page does. The existing applyDictionary() above already has
// callers (push/pull) that only want the text, so this is additive rather
// than changing its return shape.
export function applyDictionaryWithCount(
  text: string,
  entries: DictionaryEntryType[],
  direction: Direction,
): { result: string; count: number } {
  return applySubstitution(text, buildMap(entries, direction));
}
