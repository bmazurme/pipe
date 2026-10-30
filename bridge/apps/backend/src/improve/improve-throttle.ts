import { BacklogItem, priorityScore } from './analysis';

// The brake on automatic issue filing. The nightly analysis can propose one item per direction every night; filed blindly that is a new
// pull request to read and merge for every direction, whether or not it matters, and the codebase grows faster than anyone reviews it.
// So proposals are ordered by value-per-effort, the weak ones are not filed, and a direction that already has open work waits.

export interface FilingLimits {
  // Proposals with a lower "value" (1–5) are kept in the analysis but not filed.
  minValue: number;
  // Open issues of the same direction (label `category:<id>`) at which that direction stops getting new ones.
  maxOpenPerCategory: number;
  // New issues in the last 24 hours across all directions.
  dailyIssueCap: number;
}

export const DEFAULT_LIMITS: FilingLimits = {
  minValue: 3,
  maxOpenPerCategory: 3,
  dailyIssueCap: 5,
};

// The account's limits from its settings row; the defaults for an account that never saved any.
export function limitsFromSettings(
  row: Partial<FilingLimits> | null | undefined,
): FilingLimits {
  return {
    minValue: row?.minValue ?? DEFAULT_LIMITS.minValue,
    maxOpenPerCategory:
      row?.maxOpenPerCategory ?? DEFAULT_LIMITS.maxOpenPerCategory,
    dailyIssueCap: row?.dailyIssueCap ?? DEFAULT_LIMITS.dailyIssueCap,
  };
}

export interface FilingState {
  openByCategory: Record<string, number>;
  filedLast24h: number;
}

export interface FilingPlan {
  // Indices into the proposals, best first — the order to file them in.
  order: number[];
  // Why a proposal is not filed, by index.
  skipped: Map<number, string>;
}

export function planFiling(
  items: Array<Pick<BacklogItem, 'category' | 'value' | 'effort'>>,
  state: FilingState,
  limits: FilingLimits,
): FilingPlan {
  const ranked = items
    .map((item, index) => ({ item, index, score: priorityScore(item) }))
    // Stable on ties: the model's own order decides between equals.
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const open = { ...state.openByCategory };
  let filed = state.filedLast24h;
  const order: number[] = [];
  const skipped = new Map<number, string>();

  for (const { item, index } of ranked) {
    if (item.value < limits.minValue) {
      skipped.set(
        index,
        `польза ${item.value} ниже минимума ${limits.minValue}`,
      );
    } else if ((open[item.category] ?? 0) >= limits.maxOpenPerCategory) {
      skipped.set(
        index,
        `в направлении уже ${open[item.category]} открытых задач (лимит ${limits.maxOpenPerCategory})`,
      );
    } else if (filed >= limits.dailyIssueCap) {
      skipped.set(
        index,
        `за сутки уже создано ${filed} задач (лимит ${limits.dailyIssueCap})`,
      );
    } else {
      order.push(index);
      open[item.category] = (open[item.category] ?? 0) + 1;
      filed += 1;
    }
  }

  return { order, skipped };
}

// Open issues labelled `category:<id>` → count per direction.
export function countOpenByCategory(
  issues: Array<{ labels: string[] }>,
): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const issue of issues) {
    for (const label of issue.labels) {
      if (label.startsWith('category:')) {
        const id = label.slice('category:'.length);

        counts[id] = (counts[id] ?? 0) + 1;
      }
    }
  }

  return counts;
}
