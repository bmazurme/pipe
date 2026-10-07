export function formatPercent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

export function formatMs(value: number | null): string {
  if (value === null) return '—';
  if (value < 1000) return `${value} мс`;

  const seconds = Math.round(value / 1000);

  return seconds < 60 ? `${seconds} с` : `${Math.floor(seconds / 60)} мин ${String(seconds % 60).padStart(2, '0')} с`;
}
