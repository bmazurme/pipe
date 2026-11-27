import {
  isRetryableFailure,
  NOT_WORTH_RETRYING,
} from '../worker/infra-failure';

// A9 — the ladder of models. When a cheap model did not manage (the run failed, or CI stayed red after the automatic repairs), one more attempt goes to the
// model a step up: haiku → sonnet → opus, once, with a note on the run. Pure: the decision and the words; ImproveEscalationService does the starting.

// Only the Claude ladder. A provider model (gpt, deepseek, qwen, a custom one) has no «next step» here.
export const MODEL_LADDER: readonly string[] = ['haiku', 'sonnet', 'opus'];

export function nextModel(model: string): string | null {
  const index = MODEL_LADDER.indexOf(model);

  return index >= 0 && index < MODEL_LADDER.length - 1
    ? MODEL_LADDER[index + 1]
    : null;
}

export interface EscalationSettings {
  enabled: boolean;
  /** What one task (an issue, with all its runs) may have cost, API-price equivalent, before another step up is refused. */
  capTaskUsd: number;
  /** The same for the last 24 hours across every Improve run. */
  capDayUsd: number;
}

export const DEFAULT_ESCALATION: EscalationSettings = {
  enabled: false,
  capTaskUsd: 5,
  capDayUsd: 20,
};

export function escalationFromSettings(
  row:
    | {
        escalateOnFailure?: boolean | null;
        escalationCapTaskUsd?: number | null;
        escalationCapDayUsd?: number | null;
      }
    | null
    | undefined,
): EscalationSettings {
  return {
    enabled: row?.escalateOnFailure ?? DEFAULT_ESCALATION.enabled,
    capTaskUsd: row?.escalationCapTaskUsd ?? DEFAULT_ESCALATION.capTaskUsd,
    capDayUsd: row?.escalationCapDayUsd ?? DEFAULT_ESCALATION.capDayUsd,
  };
}

export type EscalationSkip =
  'off' | 'no-next-model' | 'already-escalated' | 'task-cap' | 'day-cap';

export type EscalationDecision =
  | { action: 'escalate'; to: string }
  | { action: 'skip'; reason: EscalationSkip };

export interface EscalationInput {
  settings: EscalationSettings;
  model: string;
  /** This work (the run, or the pull request) is itself an escalation, or one already followed it. */
  alreadyEscalated: boolean;
  taskSpentUsd: number;
  daySpentUsd: number;
}

// The order matters for the words the owner reads: the switch first, then what could never apply, then the money.
export function decideEscalation(input: EscalationInput): EscalationDecision {
  if (!input.settings.enabled) return { action: 'skip', reason: 'off' };

  const to = nextModel(input.model);

  if (!to) return { action: 'skip', reason: 'no-next-model' };
  if (input.alreadyEscalated) {
    return { action: 'skip', reason: 'already-escalated' };
  }
  if (input.taskSpentUsd >= input.settings.capTaskUsd) {
    return { action: 'skip', reason: 'task-cap' };
  }
  if (input.daySpentUsd >= input.settings.capDayUsd) {
    return { action: 'skip', reason: 'day-cap' };
  }

  return { action: 'escalate', to };
}

// Money, in the owner's notes: two decimals, a dot.
export function usd(value: number): string {
  return '$' + value.toFixed(2);
}

export function describeSkip(
  reason: EscalationSkip,
  settings: EscalationSettings,
): string {
  switch (reason) {
    case 'off':
      return 'эскалация выключена';
    case 'no-next-model':
      return 'выше этой модели ступени нет';
    case 'already-escalated':
      return 'выше уже поднимались один раз';
    case 'task-cap':
      return `задача уже обошлась дороже лимита ${usd(settings.capTaskUsd)}`;
    case 'day-cap':
      return `за сутки потрачено больше лимита ${usd(settings.capDayUsd)}`;
  }
}

// What the new run says about itself in its note.
export function escalationNote(
  from: string,
  to: string,
  cause: 'failed' | 'ci',
): string {
  return cause === 'ci'
    ? `Эскалация: автоисправления CI на ${from} не помогли — ещё одна попытка на ${to}`
    : `Эскалация: запуск на ${from} не удался — повтор на ${to}`;
}

// A failed job that is about the TASK: the model ran and did not get there. Not a worker that went away or a provider's bad moment (those are started over
// by themselves, R4), and not a refusal or a limit on the account — a stronger model would hit the same wall, and costs more doing it.
export function isTaskFailure(job: {
  failureKind?: 'shutdown' | 'network' | 'lost' | null;
  errorMessage: string | null;
}): boolean {
  if (
    isRetryableFailure({
      failureKind: job.failureKind ?? null,
      errorMessage: job.errorMessage,
    })
  ) {
    return false;
  }

  return !NOT_WORTH_RETRYING.test(job.errorMessage ?? '');
}

// A run that is itself the one more attempt after another.
export function isStepUp(run: { escalatedFromRunId?: number | null }): boolean {
  return (run.escalatedFromRunId ?? null) !== null;
}
