// "What needs my decision" — one list instead of five pages. Pure: the service gathers the facts, this decides what is worth an item,
// how urgent it is and where to send the owner. Nothing here is a new source of truth; every item points at the page that owns the data.

export type InboxSeverity = 'high' | 'medium' | 'low';

export type InboxKind =
  | 'pr_ready'
  | 'pr_failing'
  | 'pr_waiting'
  | 'questions'
  | 'board_offline'
  | 'board_warning'
  | 'board_outdated'
  | 'limit'
  | 'worker_offline'
  | 'jobs_failed'
  | 'loop_paused'
  | 'source_unavailable';

export interface InboxItem {
  // Stable per subject, so the page can keep a row while its text changes.
  id: string;
  kind: InboxKind;
  severity: InboxSeverity;
  title: string;
  detail?: string;
  // ISO time the thing started to need attention, when known.
  since?: string;
  // A route of bridge's own frontend.
  link: string;
  // The page may offer to open this outside bridge (a pull request).
  externalUrl?: string;
}

export interface InboxPull {
  number: number;
  title: string;
  url: string | null;
  // 'unknown' = GitHub could not be asked; the PR is still listed.
  ci: 'success' | 'failure' | 'pending' | 'none' | 'unknown';
  openedAt: string | null;
}

export interface InboxBoard {
  host: string;
  online: boolean;
  reportedAt: string;
  outdated: number;
  updatable: number;
  warnings: string[];
}

export interface InboxWorker {
  name: string;
  enabled: boolean;
  online: boolean;
  lastSeenAt: string | null;
  // Highest used share (0–1.5) over the plan windows, and the CLI's own verdict.
  limitUtilization: number | null;
  limitStatus: string | null;
}

export interface InboxFailedJob {
  id: number;
  taskKey: string | null;
  model: string;
  error: string | null;
  at: string;
}

export interface InboxFacts {
  // The kill-switch is on: nothing starts new automatic work until the owner resumes.
  loopPause: {
    reason: string | null;
    by: string | null;
    since: string | null;
  } | null;
  pulls: InboxPull[];
  openQuestions: number;
  openQuestionCards: number;
  oldestQuestionAt: string | null;
  boards: InboxBoard[];
  workers: InboxWorker[];
  failedJobs: InboxFailedJob[];
  // Names of the sources that could not be asked, so «nothing waits» is not claimed falsely.
  unavailable?: string[];
  now: Date;
}

export const LIMIT_WARN = 0.8;
export const LIMIT_CRITICAL = 0.95;
const MAX_FAILED_SHOWN = 5;
const SEVERITY_ORDER: Record<InboxSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const pct = (share: number) => `${Math.round(share * 100)} %`;
const truncate = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

export function buildInbox(facts: InboxFacts): InboxItem[] {
  const items: InboxItem[] = [];

  if (facts.loopPause) {
    items.push({
      id: 'loop-paused',
      kind: 'loop_paused',
      severity: 'high',
      title: 'Автоматика на паузе',
      detail:
        [
          facts.loopPause.reason,
          facts.loopPause.by === 'deploy'
            ? 'остановил откат релиза'
            : facts.loopPause.by === 'telegram'
              ? 'остановлено из Telegram'
              : null,
        ]
          .filter(Boolean)
          .join(' — ') || undefined,
      since: facts.loopPause.since ?? undefined,
      link: '/improve',
    });
  }

  for (const pull of facts.pulls) {
    const base = {
      link: '/improve',
      externalUrl: pull.url ?? undefined,
      since: pull.openedAt ?? undefined,
    };

    if (pull.ci === 'success') {
      items.push({
        ...base,
        id: `pr:${pull.number}`,
        kind: 'pr_ready',
        severity: 'high',
        title: `PR #${pull.number} ждёт вашего решения`,
        detail: `${truncate(pull.title, 120)} — CI зелёный`,
      });
    } else if (pull.ci === 'failure') {
      items.push({
        ...base,
        id: `pr:${pull.number}`,
        kind: 'pr_failing',
        severity: 'medium',
        title: `PR #${pull.number}: CI красный`,
        detail: `${truncate(pull.title, 120)} — автоисправление пробует сначала, потом нужен человек`,
      });
    } else {
      items.push({
        ...base,
        id: `pr:${pull.number}`,
        kind: 'pr_waiting',
        severity: 'low',
        title: `PR #${pull.number}: ${pull.ci === 'pending' ? 'CI идёт' : pull.ci === 'none' ? 'CI не запускался' : 'статус неизвестен'}`,
        detail: truncate(pull.title, 120),
      });
    }
  }

  if (facts.openQuestions > 0) {
    items.push({
      id: 'questions',
      kind: 'questions',
      severity: 'medium',
      title: `Открытых вопросов: ${facts.openQuestions}`,
      detail: `в ${facts.openQuestionCards} ${facts.openQuestionCards === 1 ? 'задаче' : 'задачах'} — без ответа агент не продолжит`,
      since: facts.oldestQuestionAt ?? undefined,
      link: '/questions',
    });
  }

  for (const board of facts.boards) {
    if (!board.online) {
      items.push({
        id: `board-offline:${board.host}`,
        kind: 'board_offline',
        severity: 'high',
        title: `Плата ${board.host} не отвечает`,
        detail: 'Давно не присылала отчёт',
        since: board.reportedAt,
        link: '/boards',
      });
    } else if (board.warnings.length > 0) {
      items.push({
        id: `board-warning:${board.host}`,
        kind: 'board_warning',
        severity: 'medium',
        title: `Плата ${board.host}: ${board.warnings[0]}`,
        detail: board.warnings.slice(1).join(' · ') || undefined,
        since: board.reportedAt,
        link: '/boards',
      });
    }

    if (board.online && board.updatable > 0) {
      items.push({
        id: `board-outdated:${board.host}`,
        kind: 'board_outdated',
        severity: 'low',
        title: `На ${board.host} можно обновить скрипты (${board.updatable})`,
        link: '/boards',
      });
    }
  }

  for (const worker of facts.workers) {
    // A paused worker is the owner's own decision; only an enabled one that went quiet is news.
    if (worker.enabled && !worker.online) {
      items.push({
        id: `worker-offline:${worker.name}`,
        kind: 'worker_offline',
        severity: 'medium',
        title: `Воркер ${worker.name} не на связи`,
        since: worker.lastSeenAt ?? undefined,
        link: '/worker?tab=workers',
      });
    }

    if (
      worker.limitStatus === 'rejected' ||
      (worker.limitUtilization ?? 0) >= LIMIT_WARN
    ) {
      const critical =
        worker.limitStatus === 'rejected' ||
        (worker.limitUtilization ?? 0) >= LIMIT_CRITICAL;

      items.push({
        id: `limit:${worker.name}`,
        kind: 'limit',
        severity: critical ? 'high' : 'medium',
        title: critical
          ? `Лимит Claude исчерпан у ${worker.name}`
          : `Лимит Claude у ${worker.name}: ${pct(worker.limitUtilization ?? 0)}`,
        detail: critical
          ? 'Новые задачи этой модели будут отклонены до сброса окна'
          : undefined,
        link: '/worker?tab=workers',
      });
    }
  }

  if (facts.failedJobs.length > 0) {
    const shown = facts.failedJobs.slice(0, MAX_FAILED_SHOWN);

    items.push({
      id: 'jobs-failed',
      kind: 'jobs_failed',
      severity: facts.failedJobs.length >= 3 ? 'high' : 'medium',
      title: `Упавших запусков за сутки: ${facts.failedJobs.length}`,
      detail: shown
        .map(
          (job) =>
            `#${job.id}${job.taskKey ? ` ${job.taskKey}` : ''}${job.error ? ` — ${truncate(job.error.replace(/\s+/g, ' '), 80)}` : ''}`,
        )
        .join('\n'),
      since: shown[0]?.at,
      link: '/worker',
    });
  }

  if (facts.unavailable && facts.unavailable.length > 0) {
    items.push({
      id: 'sources-unavailable',
      kind: 'source_unavailable',
      severity: 'low',
      title: `Не удалось проверить: ${facts.unavailable.join(', ')}`,
      detail: 'Остальное проверено; подробности в логах',
      link: '/logs',
    });
  }

  // Most urgent first; inside a level the older problem first (it has waited longest), items without a time last.
  return items.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (a.since ?? '9999').localeCompare(b.since ?? '9999'),
  );
}
