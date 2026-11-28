// A10 — what each model really closes at each size tier, from what actually happened (A1's outcomes), and what that says about the router's table of
// «tier → model». Pure: the service hands in the outcome rows and the router's current table; this builds the cards and the advice. The advice is
// only advice — nothing here changes the router; the owner presses «Применить» (or does not).
//
// How a pull request is counted: a model's CARD for a tier is made of the pull requests that were started on that model straight away. A pull request
// that needed the step up (A9) is not a success of the stronger model's card — it is a failure of the weaker one («attempted, needed more»), and it is
// counted there, otherwise «Haiku closes everything it is given» would only mean that what it could not do went to Sonnet.

import { figures, type OutcomeRow } from './quality';

export type CardVerdict = 'solid' | 'weak' | 'thin';

export interface ModelCell {
  model: string;
  tier: number;
  /** Pull requests started on this model at this tier (not step-ups), and how they ended. */
  prs: number;
  merged: number;
  closed: number;
  open: number;
  /** Times this model was not enough here and the work was retried a step up (A9). */
  stepUps: number;
  /** Merged ÷ (merged + closed + step-ups): of the attempts that have an end, the share that this model closed itself. Null with no ended attempt. */
  closeRate: number | null;
  /** The ended attempts the rate is based on. */
  samples: number;
  firstGreenRate: number | null;
  repairsPerMerged: number | null;
  revertRate: number | null;
  /** Minutes the agent worked per merged pull request (the jobs' own clock, repairs included); null when not recorded. */
  medianWorkMinutes: number | null;
  /** What starting a task on this model costs per task it ended up merging — the step-up's cost included, since that is what the ladder spends. */
  costPerMergedUsd: number | null;
  verdict: CardVerdict;
}

export type AdviceStatus = 'keep' | 'switch' | 'collect' | 'no-data';

export interface TierAdvice {
  tier: number;
  current: string;
  status: AdviceStatus;
  /** For `switch`: the model the data supports instead. */
  suggested?: string;
  reason: string;
}

export interface ModelCards {
  days: number;
  cells: ModelCell[];
  advice: TierAdvice[];
  /** The thresholds, so the page can say what «надёжно» means. */
  rules: {
    minSamples: number;
    solidCloseRate: number;
    solidFirstGreenRate: number;
    maxRevertRate: number;
    cheaperRatio: number;
  };
}

export const MIN_SAMPLES = 5;
export const SOLID_CLOSE_RATE = 0.8;
export const SOLID_FIRST_GREEN_RATE = 0.6;
export const MAX_REVERT_RATE = 0.15;
// A switch to another model for cost alone needs it to be clearly cheaper, not 5 % — the figures are small samples.
export const CHEAPER_RATIO = 0.7;

const round = (value: number, digits: number) =>
  Math.round(value * 10 ** digits) / 10 ** digits;

function median(values: number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function verdictOf(cell: Omit<ModelCell, 'verdict'>): CardVerdict {
  if (cell.samples < MIN_SAMPLES) return 'thin';

  const closes = (cell.closeRate ?? 0) >= SOLID_CLOSE_RATE;
  const green =
    cell.firstGreenRate === null ||
    cell.firstGreenRate >= SOLID_FIRST_GREEN_RATE;
  const kept = cell.revertRate === null || cell.revertRate <= MAX_REVERT_RATE;

  return closes && green && kept ? 'solid' : 'weak';
}

export function buildCells(rows: OutcomeRow[]): ModelCell[] {
  const routed = rows.filter((row) => row.tier !== null);
  const keys = new Set<string>();

  for (const row of routed) {
    keys.add(`${row.model}|${row.tier}`);

    // The model a step-up started on has a card too, even if nothing was ever started there directly.
    if (row.escalatedFrom) keys.add(`${row.escalatedFrom}|${row.tier}`);
  }

  const cells: ModelCell[] = [];

  for (const key of keys) {
    const [model, tierText] = key.split('|');
    const tier = Number(tierText);
    const direct = routed.filter(
      (row) => row.model === model && row.tier === tier && !row.escalatedFrom,
    );
    const stepped = routed.filter(
      (row) => row.escalatedFrom === model && row.tier === tier,
    );
    // Step-ups landed on this model are not its own attempts: with nothing started here and nothing handed up from here there is no card.
    if (direct.length === 0 && stepped.length === 0) continue;

    const mine = figures(direct);
    const samples = mine.merged + mine.closed + stepped.length;
    // What starting on this model costs: its own pull requests and the ones it had to hand up, over everything that ended merged.
    const started = [...direct, ...stepped];
    const startedMerged = started.filter(
      (row) => row.state === 'merged',
    ).length;
    const costs = started.filter((row) => row.costUsd !== null);
    const minutes = direct
      .filter(
        (row) => row.state === 'merged' && typeof row.workSeconds === 'number',
      )
      .map((row) => (row.workSeconds as number) / 60);
    const base = {
      model,
      tier,
      prs: direct.length,
      merged: mine.merged,
      closed: mine.closed,
      open: mine.open,
      stepUps: stepped.length,
      closeRate: samples === 0 ? null : round(mine.merged / samples, 3),
      samples,
      firstGreenRate: mine.firstGreenRate,
      repairsPerMerged: mine.repairsPerMerged,
      revertRate: mine.revertRate,
      medianWorkMinutes:
        median(minutes) === null ? null : round(median(minutes) as number, 1),
      costPerMergedUsd:
        startedMerged === 0 || costs.length === 0
          ? null
          : round(
              costs.reduce((sum, row) => sum + (row.costUsd ?? 0), 0) /
                startedMerged,
              3,
            ),
    };

    cells.push({ ...base, verdict: verdictOf(base) });
  }

  return cells.sort(
    (a, b) => a.tier - b.tier || a.model.localeCompare(b.model),
  );
}

const pct = (value: number | null) =>
  value === null ? 'нет данных' : `${Math.round(value * 100)} %`;

const usd = (value: number | null) =>
  value === null ? 'цена неизвестна' : `$${value.toFixed(2)}`;

// Cheapest first; a cell with no known cost goes last.
function byCost(a: ModelCell, b: ModelCell): number {
  if (a.costPerMergedUsd === null && b.costPerMergedUsd === null) return 0;
  if (a.costPerMergedUsd === null) return 1;
  if (b.costPerMergedUsd === null) return -1;

  return a.costPerMergedUsd - b.costPerMergedUsd;
}

export function adviseTier(
  tier: number,
  current: string,
  cells: ModelCell[],
): TierAdvice {
  const here = cells.filter((cell) => cell.tier === tier);
  const cur = here.find((cell) => cell.model === current);
  const others = here.filter((cell) => cell.model !== current);
  const solidOthers = others
    .filter((cell) => cell.verdict === 'solid')
    .sort(byCost);

  if (here.length === 0) {
    return {
      tier,
      current,
      status: 'no-data',
      reason: 'Ярус ещё не набрал ни одной завершённой задачи',
    };
  }

  if (!cur || cur.verdict === 'thin') {
    const seen = cur ? cur.samples : 0;

    return {
      tier,
      current,
      status: 'collect',
      reason: `По «${current}» данных мало (${seen} из ${MIN_SAMPLES} завершённых) — вывод рано${solidOthers.length > 0 ? `; «${solidOthers[0].model}» уже закрывает ${pct(solidOthers[0].closeRate)} (${solidOthers[0].samples})` : ''}`,
    };
  }

  if (cur.verdict === 'weak') {
    const better = solidOthers[0];

    if (better) {
      return {
        tier,
        current,
        status: 'switch',
        suggested: better.model,
        reason: `«${current}» закрыл сам ${pct(cur.closeRate)} из ${cur.samples} (шаг вверх ${cur.stepUps}); «${better.model}» — ${pct(better.closeRate)} из ${better.samples}, ${usd(better.costPerMergedUsd)} за влитую`,
      };
    }

    return {
      tier,
      current,
      status: 'collect',
      reason: `«${current}» закрыл сам ${pct(cur.closeRate)} из ${cur.samples} — ниже порога ${pct(SOLID_CLOSE_RATE)}, а надёжной замены в данных пока нет`,
    };
  }

  // The current model is solid: only a clearly cheaper solid one is worth saying.
  const cheaper = solidOthers.find(
    (cell) =>
      cell.costPerMergedUsd !== null &&
      cur.costPerMergedUsd !== null &&
      cell.costPerMergedUsd <= cur.costPerMergedUsd * CHEAPER_RATIO,
  );

  if (cheaper) {
    return {
      tier,
      current,
      status: 'switch',
      suggested: cheaper.model,
      reason: `«${current}» надёжен (${pct(cur.closeRate)} из ${cur.samples}), но «${cheaper.model}» так же надёжен (${pct(cheaper.closeRate)} из ${cheaper.samples}) и дешевле: ${usd(cheaper.costPerMergedUsd)} против ${usd(cur.costPerMergedUsd)} за влитую`,
    };
  }

  return {
    tier,
    current,
    status: 'keep',
    reason: `«${current}» закрывает ${pct(cur.closeRate)} из ${cur.samples}, ${usd(cur.costPerMergedUsd)} за влитую — менять не на что`,
  };
}

export function buildModelCards(
  rows: OutcomeRow[],
  tierModels: Record<number, string>,
  days: number,
  now: Date = new Date(),
): ModelCards {
  const since = now.getTime() - days * 24 * 60 * 60_000;
  const cells = buildCells(
    rows.filter((row) => row.openedAt.getTime() >= since),
  );

  return {
    days,
    cells,
    advice: Object.keys(tierModels)
      .map(Number)
      .sort((a, b) => a - b)
      .map((tier) => adviseTier(tier, tierModels[tier], cells)),
    rules: {
      minSamples: MIN_SAMPLES,
      solidCloseRate: SOLID_CLOSE_RATE,
      solidFirstGreenRate: SOLID_FIRST_GREEN_RATE,
      maxRevertRate: MAX_REVERT_RATE,
      cheaperRatio: CHEAPER_RATIO,
    },
  };
}
