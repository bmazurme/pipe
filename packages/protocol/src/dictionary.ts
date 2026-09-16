// Pure substitution core shared by sync (Record<string,string> loaded from a
// file), reports (DictionaryEntryType[] from its DB), and bridge's Purge page
// (PurgeEntry[] from its own API) — each side builds a Map<needle,
// replacement> from its own native shape and calls applyDictionary here, so
// the actual matching behavior (this file) can only drift in one place.

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface DictionaryResult {
  result: string;
  count: number;
}

// Longest terms first so a multi-word key wins over a shorter one that
// happens to be its prefix. Plain \b only recognizes ASCII word characters,
// so it never finds a boundary around Cyrillic (or other non-Latin) text —
// the \p{L}/\p{N} lookaround works for any script.
export function applyDictionary(text: string, dictionary: Map<string, string>): DictionaryResult {
  if (!dictionary.size || !text) {
    return { result: text, count: 0 };
  }

  const terms = [...dictionary.keys()]
    .filter((term) => term.length > 0)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);

  if (terms.length === 0) {
    return { result: text, count: 0 };
  }

  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(${terms.join('|')})(?![\\p{L}\\p{N}_])`, 'gu');

  let count = 0;
  const result = text.replace(pattern, (match) => {
    count += 1;
    return dictionary.get(match) ?? match;
  });

  return { result, count };
}
