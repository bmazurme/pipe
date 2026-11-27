// A11 — chat that knows the system. Pure: what a question about the system is, and how a snapshot of it is written down for the model. The service
// (ChatSystemFactsService) reads the database; this decides and words. Everything here is READ-ONLY by construction: the snapshot is text, and the only
// way a chat changes anything is still the `pipe-action` card the person presses.

import type { DriftView } from '../boards/drift';
import { logExcerpt } from '../worker/run-history';

export type FactsIntent = { kind: 'broken' } | { kind: 'explain'; id: number };

const BROKEN = [
  /что\s+(сейчас\s+|у\s+нас\s+|там\s+)?(сломал|не\s+так|упал|не\s+работает|горит|красн|случилось\s+с\s+систем)/i,
  /что\s+с\s+(системой|bridge|бридж|воркер|worker|платами|сервером|тревог|алерт)/i,
  /как\s+(дела|себя\s+чувствует|состояние)\s+(у\s+)?(системы|bridge|бридж|воркер)/i,
  /(статус|состояние|здоровье)\s+(системы|bridge|бриджа|воркеров)/i,
  /(есть\s+(ли\s+)?|какие\s+)(сейчас\s+)?(проблем|тревог|алерт|ошибк)/i,
  /what('?s|\s+is|\s+has)?\s+(broken|wrong|down|failing|failed)/i,
  /(system|bridge)\s+(status|health)/i,
  /anything\s+(broken|on\s+fire|failing)/i,
];

const EXPLAIN_VERB =
  /объясни|разбери|расскажи|что\s+(случилось|произошло|с|там\s+с)|почему|отчего|why|explain|what\s+happened|what\s+went/i;
// «запуск #123», «run 123», «job 123», «задача #123», or a bare «#123».
const TARGET_NUMBER =
  /(?:запуск\w*|run|job|джоб|задач\w*|#)\s*#?\s*(\d{1,7})\b/i;

export function detectIntent(text: string): FactsIntent | null {
  const explain = EXPLAIN_VERB.test(text) ? TARGET_NUMBER.exec(text) : null;

  // «объясни запуск 5» is a specific question and wins over a general one in the same message.
  if (explain) return { kind: 'explain', id: Number(explain[1]) };
  if (BROKEN.some((pattern) => pattern.test(text))) return { kind: 'broken' };

  return null;
}

// ----------------------------------------------------------------- facts

export interface AlertGroup {
  event: string;
  level: string;
  count: number;
  last: string;
  lastAt: Date;
}

export interface FailedRun {
  id: number;
  kind: string;
  issueNumber: number | null;
  title: string;
  model: string;
  error: string | null;
  finishedAt: Date | null;
  prNumber: number | null;
}

export interface FailedJob {
  id: number;
  model: string;
  error: string | null;
  finishedAt: Date | null;
  taskKey: string | null;
}

export interface SystemSnapshot {
  now: Date;
  health: { database: boolean; pendingMigrations: boolean };
  alerts: AlertGroup[];
  failedRuns: FailedRun[];
  failedJobs: FailedJob[];
  /** Improve runs waiting for the owner's answers (A6). */
  awaitingAnswers: number;
  drift: DriftView | null;
  workers: { online: string[]; offline: string[] };
}

// What the model is given is a bounded text: a snapshot that fills the context is worse than none.
export const MAX_FACTS_CHARS = 6000;

const WINDOW = 'in the last 24 hours';

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

const oneLine = (text: string | null | undefined, max = 200) =>
  clip((text ?? '').replace(/\s+/g, ' ').trim(), max);

const stamp = (date: Date | null) =>
  date ? date.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '—';

// Events that are the system working as meant (a slow request is a fact, not a fault): left out of «what broke».
const NOISY_EVENTS = [/^http\.slow$/, /^job\.succeeded$/];

// Groups the warn/error log rows of a day by event, the most frequent first. The rows come newest first.
export function groupAlerts(
  rows: Array<{
    event: string;
    level: string;
    message: string;
    createdAt: Date;
  }>,
): AlertGroup[] {
  const groups = new Map<string, AlertGroup>();

  for (const row of rows) {
    if (NOISY_EVENTS.some((pattern) => pattern.test(row.event))) continue;

    const key = `${row.level}:${row.event}`;
    const existing = groups.get(key);

    if (existing) {
      existing.count += 1;
      continue;
    }

    groups.set(key, {
      event: row.event,
      level: row.level,
      count: 1,
      last: oneLine(row.message, 160),
      lastAt: row.createdAt,
    });
  }

  return [...groups.values()].sort(
    (a, b) =>
      Number(b.level === 'error') - Number(a.level === 'error') ||
      b.count - a.count,
  );
}

const HEADER =
  'Live system snapshot taken by bridge just now. These are facts read from the system, not a guess: answer from them, say plainly when something the user asks about is not in them, and do not invent runs, errors or alerts. You cannot change anything from here; to act, propose it as the user-confirmed card described above.';

export function renderBroken(snapshot: SystemSnapshot): string {
  const lines: string[] = [
    HEADER,
    '',
    `## What is wrong now (${stamp(snapshot.now)})`,
  ];
  let problems = 0;

  if (!snapshot.health.database) {
    problems += 1;
    lines.push('- 🔴 Bridge cannot reach its database.');
  } else if (snapshot.health.pendingMigrations) {
    problems += 1;
    lines.push('- 🔴 Bridge has database migrations that did not run.');
  } else {
    lines.push('- Bridge: up, database reachable, migrations applied.');
  }

  if (snapshot.drift && snapshot.drift.items.length > 0) {
    problems += snapshot.drift.items.length;
    lines.push('', '## Drift and silent failures (boards, workers)');

    for (const item of snapshot.drift.items.slice(0, 10)) {
      lines.push(
        `- ${item.level === 'bad' ? '🔴' : '🟡'} ${item.subject}: ${item.text}`,
      );
    }
  }

  const { online, offline } = snapshot.workers;

  lines.push('', '## Workers');
  lines.push(
    online.length + offline.length === 0
      ? '- No workers registered.'
      : `- Online: ${online.length ? online.join(', ') : 'none'}${offline.length ? `. Not seen recently: ${offline.join(', ')}.` : '.'}`,
  );

  if (online.length === 0 && offline.length > 0) problems += 1;

  if (snapshot.failedRuns.length > 0 || snapshot.failedJobs.length > 0) {
    lines.push('', `## Failed ${WINDOW}`);
  }

  for (const run of snapshot.failedRuns.slice(0, 8)) {
    problems += 1;
    lines.push(
      `- Improve run #${run.id} (${run.kind}${run.issueNumber ? `, issue #${run.issueNumber}` : ''}${run.prNumber ? `, PR #${run.prNumber}` : ''}, ${run.model}) failed ${stamp(run.finishedAt)}: ${oneLine(run.error) || 'no error recorded'}`,
    );
  }

  for (const job of snapshot.failedJobs.slice(0, 8)) {
    problems += 1;
    lines.push(
      `- Worker job #${job.id} (${job.model}${job.taskKey ? `, ${job.taskKey}` : ''}) failed ${stamp(job.finishedAt)}: ${oneLine(job.error) || 'no error recorded'}`,
    );
  }

  if (snapshot.awaitingAnswers > 0) {
    lines.push(
      '',
      `- ${snapshot.awaitingAnswers} run(s) are waiting for the owner's answers (page «Вопросы»).`,
    );
  }

  if (snapshot.alerts.length > 0) {
    lines.push('', `## Warnings and errors in the log ${WINDOW}`);

    for (const alert of snapshot.alerts.slice(0, 8)) {
      lines.push(
        `- ${alert.level} ${alert.event} ×${alert.count}, last ${stamp(alert.lastAt)}: ${alert.last}`,
      );
    }
  }

  if (problems === 0 && snapshot.alerts.length === 0) {
    lines.push(
      '',
      'Nothing is failing: no drift, no failed runs or jobs and no warnings in the log.',
    );
  }

  return clip(lines.join('\n'), MAX_FACTS_CHARS);
}

// ------------------------------------------------------------ one run

export interface RunDetail {
  run: {
    id: number;
    kind: string;
    status: string;
    trigger: string;
    model: string;
    issueNumber: number | null;
    title: string;
    prNumber: number | null;
    prUrl: string | null;
    branch: string | null;
    note: string | null;
    error: string | null;
    gateRetries: number;
    escalatedFromRunId: number | null;
    createdAt: Date;
    finishedAt: Date | null;
    jobId: number | null;
  } | null;
  job: {
    id: number;
    status: string;
    model: string;
    error: string | null;
    logs: string;
    createdAt: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
    costUsd: number | null;
  } | null;
  /** A job that the run points at, when `job` is another one (the number matched both). */
  linkedJobId: number | null;
}

const seconds = (from: Date | null, to: Date | null) =>
  from && to
    ? Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000))
    : null;

export function renderExplain(id: number, detail: RunDetail): string {
  if (!detail.run && !detail.job) {
    return [
      HEADER,
      '',
      `## №${id}`,
      `Neither an Improve run nor a Worker job with the number ${id} exists for this account. Say so; do not guess what it was.`,
    ].join('\n');
  }

  const lines: string[] = [HEADER];

  if (detail.run) {
    const { run } = detail;

    lines.push(
      '',
      `## Improve run #${run.id} — ${run.status}`,
      `- ${run.kind}${run.issueNumber ? ` on issue #${run.issueNumber}` : ''} «${oneLine(run.title, 120)}», model ${run.model}, started by ${run.trigger}`,
      `- Created ${stamp(run.createdAt)}, finished ${stamp(run.finishedAt)}`,
    );

    if (run.prNumber)
      lines.push(
        `- Pull request #${run.prNumber}${run.prUrl ? ` ${run.prUrl}` : ''}${run.branch ? `, branch ${run.branch}` : ''}`,
      );
    if (run.error) lines.push(`- Error: ${oneLine(run.error, 600)}`);
    if (run.note) lines.push(`- Note: ${oneLine(run.note, 400)}`);
    if (run.gateRetries > 0)
      lines.push(
        `- The check before the pull request failed and the worker was sent back to fix it ${run.gateRetries} time(s).`,
      );
    if (run.escalatedFromRunId)
      lines.push(
        `- This run is the one more attempt on a stronger model after run #${run.escalatedFromRunId} did not manage.`,
      );
    if (run.jobId) lines.push(`- Its Worker job: #${run.jobId}`);
  }

  if (detail.job) {
    const { job } = detail;
    const took = seconds(job.startedAt, job.finishedAt);

    lines.push(
      '',
      `## Worker job #${job.id} — ${job.status}`,
      `- Model ${job.model}, created ${stamp(job.createdAt)}${took !== null ? `, ran ${took} s` : ''}${job.costUsd !== null ? `, cost ≈ $${job.costUsd.toFixed(2)} (API-price equivalent)` : ''}`,
    );

    if (job.error) lines.push(`- Error: ${oneLine(job.error, 600)}`);

    const tail = logExcerpt(job.logs);

    if (tail) lines.push('- End of its log:', tail);
  }

  if (detail.run && !detail.job && detail.linkedJobId) {
    lines.push(
      '',
      `(The job #${detail.linkedJobId} of this run is gone or was not readable.)`,
    );
  }

  return clip(lines.join('\n'), MAX_FACTS_CHARS);
}
