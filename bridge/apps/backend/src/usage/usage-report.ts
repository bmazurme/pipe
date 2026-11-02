// "What did the agent cost, and what did it give?" per task. Pure: the service reads the rows, this attributes each job to a task and sums.
// costUsd is what the Claude CLI reports for the run — the API-price equivalent, not what a subscription plan charges — so it is a
// yardstick for comparing tasks and models, not an invoice. Chat turns are not jobs and are not counted.

import type { Routing } from '../router/router-policy';

export type UsageTaskKind = 'improve' | 'lab' | 'analysis' | 'parcel';

export interface UsageJob {
  id: number;
  model: string;
  status: string;
  taskKey: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  usage: {
    costUsd: number | null;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  } | null;
}

// The run (Improve or Lab) a job belongs to, when it belongs to one.
export interface UsageRun {
  jobId: number | null;
  kind: 'improve' | 'lab';
  // Improve: 'issue' | 'analysis' | 'repair'. Lab runs have no such split.
  runKind?: string;
  issueNumber: number | null;
  runId: number;
  title: string;
  status: string;
  prNumber: number | null;
  prUrl: string | null;
  // The router's decision for an 'auto' run; absent or null for a run on a fixed model.
  routing?: Routing | null;
}

export interface UsageTotals {
  jobs: number;
  failed: number;
  machineSeconds: number;
  tokens: number;
  costUsd: number;
  // Jobs whose run reported no cost (non-Claude models, runs that died early): the sums are lower bounds by this many.
  withoutCost: number;
}

export interface UsageModelRow extends UsageTotals {
  model: string;
}

export interface UsageRouteRow extends UsageTotals {
  // 'rule:<name>', 'tier:<n>' or 'fallback'.
  route: string;
  label: string;
  // Distinct tasks of this route that ended in a pull request.
  pullRequests: number;
}

export interface UsageTaskRow extends UsageTotals {
  key: string;
  kind: UsageTaskKind;
  title: string;
  // Latest state of the task's run, as the owner knows it (pr_open, failed, …); null for a plain parcel.
  outcome: string | null;
  prNumber: number | null;
  prUrl: string | null;
  firstAt: string;
  lastAt: string;
}

export interface UsageReport {
  from: string;
  to: string;
  totals: UsageTotals;
  // Tasks that ended in a pull request, and what one cost on average across them (null when none did).
  pullRequests: number;
  costPerPullRequest: number | null;
  byModel: UsageModelRow[];
  byRoute: UsageRouteRow[];
  tasks: UsageTaskRow[];
}

const emptyTotals = (): UsageTotals => ({
  jobs: 0,
  failed: 0,
  machineSeconds: 0,
  tokens: 0,
  costUsd: 0,
  withoutCost: 0,
});

function add(totals: UsageTotals, job: UsageJob): void {
  totals.jobs += 1;
  if (job.status === 'failed') totals.failed += 1;

  if (job.startedAt && job.finishedAt) {
    totals.machineSeconds += Math.max(
      0,
      Math.round((job.finishedAt.getTime() - job.startedAt.getTime()) / 1000),
    );
  }

  const usage = job.usage;

  if (usage) {
    totals.tokens +=
      usage.inputTokens +
      usage.outputTokens +
      usage.cacheReadTokens +
      usage.cacheCreationTokens;
  }

  if (usage?.costUsd != null) totals.costUsd += usage.costUsd;
  else totals.withoutCost += 1;
}

const round = (value: number, digits = 4) => {
  const k = 10 ** digits;

  return Math.round(value * k) / k;
};

const tidy = <T extends UsageTotals>(row: T): T => ({
  ...row,
  costUsd: round(row.costUsd),
});

function routeOf(
  routing: Routing | null | undefined,
): { route: string; label: string } | null {
  if (!routing) return null;

  if (routing.source === 'rule' && routing.rule) {
    return {
      route: `rule:${routing.rule}`,
      label: `Правило «${routing.rule}»`,
    };
  }

  if (routing.source === 'fallback') {
    return {
      route: 'fallback',
      label: `Не определён → ${routing.model}`,
    };
  }

  if (routing.tier !== undefined) {
    return { route: `tier:${routing.tier}`, label: `Ярус ${routing.tier}` };
  }

  return null;
}

const LABEL_MAX = 140;
const truncate = (text: string) =>
  text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1)}…` : text;

export function buildUsageReport(
  jobs: UsageJob[],
  runs: UsageRun[],
  range: { from: Date; to: Date },
  maxTasks = 50,
): UsageReport {
  const runByJob = new Map<number, UsageRun>();

  for (const run of runs) if (run.jobId !== null) runByJob.set(run.jobId, run);

  const totals = emptyTotals();
  const models = new Map<string, UsageModelRow>();
  const tasks = new Map<string, UsageTaskRow>();
  const routes = new Map<string, UsageRouteRow>();
  const routePrs = new Map<string, Set<string>>();

  for (const job of jobs) {
    add(totals, job);

    const model = models.get(job.model) ?? {
      model: job.model,
      ...emptyTotals(),
    };

    add(model, job);
    models.set(job.model, model);

    const run = runByJob.get(job.id);
    const decision = routeOf(run?.routing);

    if (run && decision) {
      const row = routes.get(decision.route) ?? {
        ...decision,
        pullRequests: 0,
        ...emptyTotals(),
      };

      add(row, job);
      routes.set(decision.route, row);

      if (run.prNumber != null) {
        const prs = routePrs.get(decision.route) ?? new Set<string>();

        prs.add(`${run.kind}:${run.issueNumber ?? run.runId}`);
        routePrs.set(decision.route, prs);
      }
    }

    let key: string;
    let kind: UsageTaskKind;
    let title: string;

    if (run?.kind === 'improve' && run.runKind === 'analysis') {
      key = 'analysis';
      kind = 'analysis';
      title = 'Анализы репозитория';
    } else if (run?.kind === 'improve') {
      // The CI repairs of an issue's pull request belong to that issue: what it cost to make it green is part of its cost.
      key = `improve:${run.issueNumber ?? run.runId}`;
      kind = 'improve';
      title = `Issue #${run.issueNumber ?? '?'}: ${run.title}`;
    } else if (run?.kind === 'lab') {
      key = `lab:${run.runId}`;
      kind = 'lab';
      title = `Lab #${run.runId}: ${run.title}`;
    } else {
      key = job.taskKey ?? `job:${job.id}`;
      kind = 'parcel';
      title = job.taskKey ?? `Задача #${job.id}`;
    }

    const at = job.createdAt.toISOString();
    const task: UsageTaskRow = tasks.get(key) ?? {
      key,
      kind,
      title: truncate(title),
      outcome: null,
      prNumber: null,
      prUrl: null,
      firstAt: at,
      lastAt: at,
      ...emptyTotals(),
    };

    add(task, job);
    if (at < task.firstAt) task.firstAt = at;

    // The newest job decides the state shown for the task.
    if (at >= task.lastAt) {
      task.lastAt = at;
      if (run) task.outcome = run.status;
    }

    if (run?.prNumber != null) {
      task.prNumber = run.prNumber;
      task.prUrl = run.prUrl;
    }

    tasks.set(key, task);
  }

  const taskRows = [...tasks.values()].sort(
    (a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens || b.jobs - a.jobs,
  );
  const withPr = taskRows.filter((task) => task.prNumber !== null);
  const prCost = withPr.reduce((sum, task) => sum + task.costUsd, 0);

  return {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    totals: tidy(totals),
    pullRequests: withPr.length,
    costPerPullRequest: withPr.length ? round(prCost / withPr.length) : null,
    byModel: [...models.values()]
      .map(tidy)
      .sort((a, b) => b.costUsd - a.costUsd || b.jobs - a.jobs),
    byRoute: [...routes.values()]
      .map((row) => tidy({ ...row, pullRequests: routePrs.get(row.route)?.size ?? 0 }))
      .sort((a, b) => b.costUsd - a.costUsd || b.jobs - a.jobs),
    tasks: taskRows.slice(0, maxTasks).map(tidy),
  };
}
