import type { CardVerdict, ModelCell } from '../../store/api';

export const VERDICT_LABEL: Record<CardVerdict, string> = { solid: 'надёжно', weak: 'слабо', thin: 'мало данных' };

export const VERDICT_THEME: Record<CardVerdict, 'success' | 'danger' | 'unknown'> = { solid: 'success', weak: 'danger', thin: 'unknown' };

export const percent = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)} %`);

export const usd = (value: number | null) => (value === null ? '—' : `$${value.toFixed(2)}`);

export const minutes = (value: number | null) => (value === null ? '—' : value < 1 ? '< 1 мин' : `${Math.round(value)} мин`);

/** The cards grouped by tier, in tier order. */
export function byTier(cells: ModelCell[]): { tier: number; cells: ModelCell[] }[] {
  const tiers = [...new Set(cells.map((cell) => cell.tier))].sort((a, b) => a - b);

  return tiers.map((tier) => ({ tier, cells: cells.filter((cell) => cell.tier === tier) }));
}
