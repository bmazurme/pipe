/** What the switcher needs of a page: the home link has no description, a service has one. */
interface Destination {
  id: string;
  title: string;
  path: string;
  description?: string;
}

/**
 * The destinations that answer `query`, best first: a title that starts with it, then a title that contains it, then a description with a word that starts with it.
 * An empty query lists everything in the order the sidebar has them. Case and «ё» do not matter; every word of the query has to match.
 */
export function filterDestinations<T extends Destination>(items: T[], query: string): T[] {
  const words = normalise(query).split(/\s+/).filter(Boolean);

  if (words.length === 0) return items;

  const scored: { item: T; score: number }[] = [];

  for (const item of items) {
    const title = normalise(item.title);
    const id = normalise(item.id);
    const described = normalise(item.description ?? '').split(/[^a-zа-я0-9]+/).filter(Boolean);
    // A word of the query has to start a word of the description (not sit in the middle of one: «да» is in «данные» and «задачи»), or be anywhere in the title.
    const matches = (word: string) => title.includes(word) || id.startsWith(word) || described.some((token) => token.startsWith(word));

    if (!words.every(matches)) continue;

    const score = words.every((word) => title.startsWith(word) || title.includes(` ${word}`)) ? 0 : words.every((word) => title.includes(word)) ? 1 : 2;

    scored.push({ item, score });
  }

  // Array.prototype.sort is stable: the sidebar order is kept inside one score.
  return scored.sort((a, b) => a.score - b.score).map((entry) => entry.item);
}

const normalise = (text: string) => text.toLowerCase().replace(/ё/g, 'е').trim();

/** Ctrl+K or ⌘+K — the same chord every app with a page switcher uses. */
export function isQuickSwitchChord(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k';
}
