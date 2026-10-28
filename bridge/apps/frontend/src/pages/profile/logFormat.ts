export function formatPercent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

export function formatMs(value: number | null): string {
  if (value === null) return '—';
  if (value < 1000) return `${value} мс`;

  const seconds = Math.round(value / 1000);

  return seconds < 60 ? `${seconds} с` : `${Math.floor(seconds / 60)} мин ${String(seconds % 60).padStart(2, '0')} с`;
}

const MIN_SEARCH_TERM_LENGTH = 3;

// The summary replaces every number with `N`, so the text cannot be searched as is: keep the longest literal piece around the placeholders.
export function searchTermFromNormalized(message: string): string {
  const fragments = message
    .split(/(?<![A-Z])N(?![A-Z])|→|…/)
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length >= MIN_SEARCH_TERM_LENGTH);

  return fragments.reduce((best, fragment) => (fragment.length > best.length ? fragment : best), '');
}
