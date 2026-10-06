import * as clack from '@clack/prompts';

import { DEFAULT_ACTION_DEPS, runAction, type ActionDeps } from './actions.js';
import { DEFAULT_PATHS, type StatusPaths } from './collect.js';
import { DEFAULT_STALE_HOURS } from './deriveStatus.js';
import { rankTasks, type NextRecommendation } from './next.js';
import { buildReportData } from './reportBuilder.js';

// IMPROVEMENTS_HARNESS.md 2.4 — "pipe без аргументов": pipe-status with
// zero flags, on a real terminal, launches this instead of printing the
// static report (see cli.ts's own gate — any flag at all, or no TTY,
// keeps the existing plain-text behavior unchanged for scripts/CI, which
// is the one thing the original doc text was explicit about preserving).
// @clack/prompts (the doc's own suggestion, over `ink`) because its
// `select()` is already exactly "list + arrows + Enter" — no custom
// rendering to write.

const EXIT_VALUE = '__exit__';

// The one pure, independently-testable piece — everything else in this
// file is thin glue around real clack prompts and real I/O (buildReportData,
// runAction), the same "don't unit-test the interactive glue itself"
// convention actions.ts's own defaultConfirm already follows.
export function buildTaskChoices(ranked: NextRecommendation[]): { value: string; label: string; hint?: string }[] {
  return ranked.map((item) => ({
    value: item.key,
    label: `[${item.bucket}] ${item.key} — ${item.label}`,
    hint: item.nextAction ? (item.nextAction.command ?? item.nextAction.label) : 'nothing to do yet',
  }));
}

export interface RunTuiOptions {
  paths?: Partial<StatusPaths>;
  staleHours?: number;
  actionDeps?: ActionDeps;
}

// Re-fetches and re-ranks on every loop iteration (not just once at
// startup) — running an action changes local state (and bridge/GitLab,
// under live data), so the list after "Enter" should reflect what just
// happened, not a stale snapshot from before it.
export async function runTui(options: RunTuiOptions = {}): Promise<number> {
  const paths = { ...DEFAULT_PATHS, ...options.paths };
  const staleHours = options.staleHours ?? DEFAULT_STALE_HOURS;
  const actionDeps = options.actionDeps ?? DEFAULT_ACTION_DEPS;

  clack.intro('pipe-status');

  for (;;) {
    // Always live — unlike the plain report (--live is opt-in there), a
    // bare interactive invocation is already an explicit "give me the full
    // picture" choice, and the one thing worth waiting a moment longer for
    // here is not missing a confirmed-ready result or a newly assigned
    // issue that only --live can see.
    const built = await buildReportData({ paths, live: true, staleHours });
    const liveTasks = built.liveResult?.available ? built.liveResult.data.tasks : undefined;
    const incoming = built.gitlabLiveResult?.available ? built.gitlabLiveResult.data.incoming : [];
    const ranked = rankTasks(built.data.tasks, incoming, liveTasks);

    if (ranked.length === 0) {
      clack.outro('Nothing urgent — all clear.');
      return 0;
    }

    const choice = await clack.select({
      message: `${ranked.length} task${ranked.length === 1 ? '' : 's'} need attention`,
      options: [...buildTaskChoices(ranked), { value: EXIT_VALUE, label: 'Exit' }],
    });

    if (clack.isCancel(choice) || choice === EXIT_VALUE) {
      clack.outro('Bye.');
      return 0;
    }

    const picked = ranked.find((item) => item.key === choice);
    if (!picked) continue;

    if (!picked.nextAction) {
      clack.log.info(`${picked.key}: ${picked.label} — nothing to do yet.`);
      continue;
    }

    if (!picked.nextAction.actionKind) {
      // e.g. "investigate the failing pipeline for MR !42" — a real next
      // step, just not one runAction (2.3) can execute on the user's behalf.
      clack.log.info(`${picked.key}: ${picked.nextAction.label}`);
      continue;
    }

    const commandSuffix = picked.nextAction.command ? ` — ${picked.nextAction.command}` : '';
    const proceed = await clack.confirm({ message: `${picked.nextAction.label}${commandSuffix}. Proceed?` });
    if (clack.isCancel(proceed) || !proceed) continue;

    // yes: true — the confirmation above *is* the confirmation; runAction's
    // own (readline-based) prompt would just ask the same question again.
    const result = await runAction(picked.nextAction.actionKind, picked.key, { yes: true, dryRun: false }, actionDeps);
    if (result.output) {
      (result.code === 0 ? clack.log.success : clack.log.error)(result.output);
    }
  }
}
