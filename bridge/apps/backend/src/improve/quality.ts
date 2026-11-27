// A1 — how good is the assistant, in numbers. Pure: the service keeps one outcome row per pull request an Improve run opened; this says which
// of them still need to be looked at on GitHub and turns the rows into the figures of the page «Качество». Without these figures any change of a
// prompt, a model or the router is a guess (A4 builds on them).

import type { FirstCi, OutcomeState } from './entities/improve-outcome.entity';

export interface OutcomeRow {
  prNumber: number;
  model: string;
  tier: number | null;
  state: OutcomeState;
  firstCi: FirstCi | null;
  ciRepairs: number;
  costUsd: number | null;
  openedAt: Date;
  mergedAt: Date | null;
  reverted: boolean;
}

export interface QualityFigures {
  /** Pull requests opened in the period. */
  opened: number;
  merged: number;
  /** Closed without a merge. */
  closed: number;
  open: number;
  /** Of the pull requests whose first CI has finished: the share that was green at the first attempt (0–1), null when none finished. */
  firstGreenRate: number | null;
  /** Automatic CI repairs per merged pull request. */
  repairsPerMerged: number | null;
  /** Median hours from opening to merge. */
  medianHoursToMerge: number | null;
  /** What all the pull requests cost, divided by how many were merged: a closed one is a cost with nothing to show for it. */
  costPerMergedUsd: number | null;
  /** Pull requests whose cost is unknown (the run reported none) — the cost is a lower bound by this many. */
  withoutCost: number;
  /** Merged pull requests that a later one reverted, as a share of the merged ones (0–1). */
  revertRate: number | null;
}

export interface QualityGroup extends QualityFigures {
  key: string;
}

export interface QualityView {
  days: number;
  total: QualityFigures;
  byModel: QualityGroup[];
  byTier: QualityGroup[];
}

// After this long a merged pull request cannot become "reverted within the window" any more, and a closed one never changes: stop asking.
export const REVERT_WINDOW_MS = 7 * 24 * 60 * 60_000;
// An open pull request is looked at again every sync; a merged one until the revert window has passed.
export function needsRefresh(
  row: { state: OutcomeState; mergedAt: Date | null; firstCi: FirstCi | null },
  now: Date,
): boolean {
  if (row.state === 'closed') return false;
  if (row.state === 'open') return true;
  if (row.firstCi === null) return true;

  return (
    row.mergedAt === null ||
    now.getTime() - row.mergedAt.getTime() < REVERT_WINDOW_MS
  );
}

// `Revert "title (#123)"` — the title GitHub gives the pull request made by the Revert button; written by hand it is usually the same.
export function revertedPrNumbers(
  titles: Array<{ number: number; title: string }>,
): Set<number> {
  const reverted = new Set<number>();

  for (const { title } of titles) {
    if (!/^revert\b/i.test(title.trim())) continue;

    for (const match of title.matchAll(/#(\d+)/g)) {
      reverted.add(Number(match[1]));
    }
  }

  return reverted;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

const round = (value: number, digits: number) =>
  Math.round(value * 10 ** digits) / 10 ** digits;

export function figures(rows: OutcomeRow[]): QualityFigures {
  const merged = rows.filter((row) => row.state === 'merged');
  const decided = rows.filter(
    (row) => row.firstCi === 'success' || row.firstCi === 'failure',
  );
  const costs = rows.filter((row) => row.costUsd !== null);
  const totalCost = costs.reduce((sum, row) => sum + (row.costUsd ?? 0), 0);
  const hours = merged
    .filter((row) => row.mergedAt !== null)
    .map(
      (row) =>
        ((row.mergedAt as Date).getTime() - row.openedAt.getTime()) / 3_600_000,
    );

  return {
    opened: rows.length,
    merged: merged.length,
    closed: rows.filter((row) => row.state === 'closed').length,
    open: rows.filter((row) => row.state === 'open').length,
    firstGreenRate:
      decided.length === 0
        ? null
        : round(
            decided.filter((row) => row.firstCi === 'success').length /
              decided.length,
            3,
          ),
    repairsPerMerged:
      merged.length === 0
        ? null
        : round(
            merged.reduce((sum, row) => sum + row.ciRepairs, 0) / merged.length,
            2,
          ),
    medianHoursToMerge:
      median(hours) === null ? null : round(median(hours) as number, 2),
    costPerMergedUsd:
      merged.length === 0 || costs.length === 0
        ? null
        : round(totalCost / merged.length, 3),
    withoutCost: rows.length - costs.length,
    revertRate:
      merged.length === 0
        ? null
        : round(merged.filter((row) => row.reverted).length / merged.length, 3),
  };
}

function groupBy(
  rows: OutcomeRow[],
  keyOf: (row: OutcomeRow) => string,
  order: (a: string, b: string) => number,
): QualityGroup[] {
  const groups = new Map<string, OutcomeRow[]>();

  for (const row of rows) {
    const key = keyOf(row);

    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => order(a, b))
    .map(([key, list]) => ({ key, ...figures(list) }));
}

export function summarizeQuality(
  rows: OutcomeRow[],
  days: number,
  now: Date = new Date(),
): QualityView {
  const since = now.getTime() - days * 24 * 60 * 60_000;
  const inPeriod = rows.filter((row) => row.openedAt.getTime() >= since);

  return {
    days,
    total: figures(inPeriod),
    byModel: groupBy(
      inPeriod,
      (row) => row.model,
      (a, b) => a.localeCompare(b),
    ),
    // «без яруса»: a run on a fixed model was not routed, so it has no tier.
    byTier: groupBy(
      inPeriod,
      (row) => (row.tier === null ? 'none' : String(row.tier)),
      (a, b) => (a === 'none' ? 1 : b === 'none' ? -1 : Number(a) - Number(b)),
    ),
  };
}
