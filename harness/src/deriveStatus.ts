import type { TaskEntry, ReportData } from './collect.js';

export interface DerivedStatus {
  label: string;
  stale: boolean;
}

export interface AnnotatedTaskEntry extends TaskEntry {
  status: DerivedStatus;
}

export interface AnnotatedReportData extends ReportData {
  tasks: AnnotatedTaskEntry[];
}

export const DEFAULT_STALE_HOURS = 24;

function hoursSince(iso: string, now: number): number {
  return (now - Date.parse(iso)) / (60 * 60 * 1000);
}

// Synthesizes one combined label per task from whichever signals are
// present — this is the actual "merged view," versus just listing each
// side's raw fields next to each other. Reports' own `step` is the fullest
// single-file record of an issue's lifecycle when it's there; gitlab-worker
// + agent-runner's dedup hash are the best available signal when it isn't
// (e.g. this machine only runs sync-cli, not reports). All local-only — no
// bridge query, so "ready to pull" is an inference from what was last
// pushed locally, not a live check of what's still on bridge.
export function deriveStatus(task: TaskEntry, staleHours: number, now: number): DerivedStatus {
  const s = task.subscription;

  if (s) {
    switch (s.step) {
      case 'published':
        return { label: 'published — done', stale: false };
      case 'pulled': {
        const stale = Boolean(s.pulledAt) && hoursSince(s.pulledAt!, now) > staleHours;
        return {
          label: stale ? `pulled ${s.pulledAt} — not yet published` : 'pulled — ready to publish',
          stale,
        };
      }
      case 'pushed': {
        const stale = Boolean(s.pushedAt) && hoursSince(s.pushedAt!, now) > staleHours;
        return {
          label: stale ? `pushed ${s.pushedAt} — no pull since` : 'pushed — waiting to be pulled',
          stale,
        };
      }
      default:
        return { label: `${s.step} — not yet pushed`, stale: false };
    }
  }

  if (task.gitlabWorker) {
    const stale = hoursSince(task.gitlabWorker.pushedAt, now) > staleHours;

    if (task.syncAgent) {
      return { label: 'agent-runner already pushed a result back — likely ready to pull', stale: false };
    }

    return {
      label: stale
        ? `pushed to bridge ${task.gitlabWorker.pushedAt} — still waiting on agent-runner`
        : 'pushed to bridge — waiting on agent-runner',
      stale,
    };
  }

  if (task.syncAgent) {
    return { label: 'agent-runner has pushed at least one result (no gitlab-worker record for it)', stale: false };
  }

  return { label: 'no local state', stale: false };
}

export function annotateTasks(tasks: TaskEntry[], staleHours: number, now: number = Date.now()): AnnotatedTaskEntry[] {
  return tasks.map((task) => ({ ...task, status: deriveStatus(task, staleHours, now) }));
}

// Non-zero when there's something actionable to see: a malformed state
// file, or a task whose derived status came back stale — lets pipe-status
// double as a cron/CI health check, not only something a human has to read.
export function exitCodeFor(data: AnnotatedReportData): number {
  const hasStaleTask = data.tasks.some((task) => task.status.stale);
  return data.errors.length > 0 || hasStaleTask ? 1 : 0;
}
