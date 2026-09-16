import type { DictionaryEntryType } from '@reports/shared';

export type Direction = 'toRemote' | 'toLocal';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
 * with real values (`toLocal`). Longest keys are matched first so a
 * multi-word key wins over a shorter one that happens to be its prefix, and
 * matches are bounded by Unicode letter/digit/underscore so short keys don't
 * match inside unrelated identifiers. Mirrors ntlstl.sync's dictionary.ts /
 * ntlstl.bridge's purgeUtils.ts so a dictionary exported from either can be
 * reused here unchanged.
 */
export function applyDictionary(text: string, entries: DictionaryEntryType[], direction: Direction): string {
  const map = buildMap(entries, direction);

  if (!map.size || !text) {
    return text;
  }

  const terms = [...map.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(${terms.join('|')})(?![\\p{L}\\p{N}_])`, 'gu');

  return text.replace(pattern, (match) => map.get(match) ?? match);
}
