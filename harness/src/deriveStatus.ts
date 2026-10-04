import type { LiveTaskInfo } from './bridgeLive.js';
import type { TaskEntry, ReportData } from './collect.js';

export interface DerivedStatus {
  label: string;
  stale: boolean;
  // Only present when --live supplied a fact for this task
  // (IMPROVEMENTS_HARNESS.md 1.1) — omitted entirely rather than left
  // undefined so the offline-only shape (and the tests asserting it via
  // deepEqual) stays unchanged when live data wasn't requested.
  liveNote?: string;
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

function liveNoteFor(live: LiveTaskInfo | undefined): string | undefined {
  if (!live?.job) return undefined;

  const job = live.job;
  const parts = [`worker job #${job.id} (${job.model}): ${job.status}`];
  if (job.errorMessage) parts.push(`error: ${job.errorMessage}`);
  return parts.join(', ');
}

// Synthesizes one combined label per task from whichever signals are
// present — this is the actual "merged view," versus just listing each
// side's raw fields next to each other. Reports' own `step` is the fullest
// single-file record of an issue's lifecycle when it's there; gitlab-worker
// + agent-runner's dedup hash are the best available signal when it isn't
// (e.g. this machine only runs sync-cli, not reports). Without `live`
// (IMPROVEMENTS_HARNESS.md 1.1's --live), this is all local-only — no bridge
// query, so "ready to pull" is an inference from what was last pushed
// locally, not a fact about what's still on bridge; `live`, when supplied,
// both upgrades that one guess into a fact and attaches the worker job's
// own status as `liveNote` regardless of which branch below matched.
export function deriveStatus(task: TaskEntry, staleHours: number, now: number, live?: LiveTaskInfo): DerivedStatus {
  const s = task.subscription;
  const liveNote = liveNoteFor(live);
  const withLiveNote = (status: DerivedStatus): DerivedStatus => (liveNote ? { ...status, liveNote } : status);

  if (s) {
    switch (s.step) {
      case 'published':
        return withLiveNote({ label: 'published — done', stale: false });
      case 'pulled': {
        const stale = Boolean(s.pulledAt) && hoursSince(s.pulledAt!, now) > staleHours;
        return withLiveNote({
          label: stale ? `pulled ${s.pulledAt} — not yet published` : 'pulled — ready to publish',
          stale,
        });
      }
      case 'pushed': {
        const stale = Boolean(s.pushedAt) && hoursSince(s.pushedAt!, now) > staleHours;
        return withLiveNote({
          label: stale ? `pushed ${s.pushedAt} — no pull since` : 'pushed — waiting to be pulled',
          stale,
        });
      }
      default:
        return withLiveNote({ label: `${s.step} — not yet pushed`, stale: false });
    }
  }

  if (task.gitlabWorker) {
    const stale = hoursSince(task.gitlabWorker.pushedAt, now) > staleHours;

    if (task.syncAgent) {
      if (live) {
        return withLiveNote(
          live.hasResultInStorage
            ? { label: 'agent-runner pushed a result — confirmed in bridge storage, ready to pull', stale: false }
            : {
                label: 'agent-runner pushed a result locally, but bridge storage has no result yet',
                stale: false,
              },
        );
      }
      return { label: 'agent-runner already pushed a result back — likely ready to pull', stale: false };
    }

    return withLiveNote({
      label: stale
        ? `pushed to bridge ${task.gitlabWorker.pushedAt} — still waiting on agent-runner`
        : 'pushed to bridge — waiting on agent-runner',
      stale,
    });
  }

  if (task.syncAgent) {
    return withLiveNote({ label: 'agent-runner has pushed at least one result (no gitlab-worker record for it)', stale: false });
  }

  return withLiveNote({ label: 'no local state', stale: false });
}

export function annotateTasks(
  tasks: TaskEntry[],
  staleHours: number,
  now: number = Date.now(),
  liveTasks?: Map<string, LiveTaskInfo>,
): AnnotatedTaskEntry[] {
  return tasks.map((task) => ({ ...task, status: deriveStatus(task, staleHours, now, liveTasks?.get(task.key)) }));
}

// Non-zero when there's something actionable to see: a malformed state
// file, or a task whose derived status came back stale — lets pipe-status
// double as a cron/CI health check, not only something a human has to read.
export function exitCodeFor(data: AnnotatedReportData): number {
  const hasStaleTask = data.tasks.some((task) => task.status.stale);
  return data.errors.length > 0 || hasStaleTask ? 1 : 0;
}
