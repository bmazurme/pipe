import type { LiveTaskInfo } from './bridgeLive.js';
import type { TaskEntry, ReportData } from './collect.js';
import type { LiveGitlabTaskInfo } from './gitlabLive.js';

// IMPROVEMENTS_HARNESS.md 2.1 — "pulled — ready to publish" tells the user
// a fact, not what to do about it. `command` is only filled in for an
// action sync-cli can run by itself (push-issue/pull-issue); it's omitted
// when the actual next step is a UI action (reports' Publish button) or
// there's nothing to do yet (waiting on another machine's agent-runner).
// `<name>` is a deliberate placeholder, not a resolved value: sync-cli's
// local project alias isn't recorded in any of the state files harness
// reads (only sync's own sync.config.json has it, and that file's
// `gitlabProjectId` is itself optional — agent-runner-only setups often
// leave it unset), so harness can't always resolve it correctly. Spelling
// out the placeholder is more honest than guessing a name that might be
// wrong.
export interface NextAction {
  label: string;
  command?: string;
}

export interface DerivedStatus {
  label: string;
  stale: boolean;
  // Only present when --live supplied a fact for this task
  // (IMPROVEMENTS_HARNESS.md 1.1) — omitted entirely rather than left
  // undefined so the offline-only shape (and the tests asserting it via
  // deepEqual) stays unchanged when live data wasn't requested.
  liveNote?: string;
  // Same reasoning, for GitLab's own live state instead of bridge's
  // (IMPROVEMENTS_HARNESS.md 1.2) — issue open/closed, and the newest MR
  // for this task's branch with its pipeline status.
  gitlabNote?: string;
  // Omitted (not left undefined) when there's genuinely nothing to do yet
  // — same "absent means no signal" convention as liveNote/gitlabNote.
  nextAction?: NextAction;
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

function gitlabNoteFor(info: LiveGitlabTaskInfo | undefined): string | undefined {
  if (!info) return undefined;

  const parts: string[] = [];
  if (info.issueState) parts.push(`issue ${info.issueState}`);
  parts.push(
    info.mergeRequest
      ? `MR !${info.mergeRequest.iid} (${info.mergeRequest.state}), pipeline ${info.mergeRequest.pipelineStatus ?? 'none yet'}`
      : 'no MR for this branch yet',
  );
  return parts.join(', ');
}

// 'failed'/'canceled' specifically — 'running'/'pending'/'success'/'skipped'
// are all either fine or still in progress, not something to flag.
function gitlabPipelineFailed(info: LiveGitlabTaskInfo | undefined): boolean {
  const status = info?.mergeRequest?.pipelineStatus;
  return status === 'failed' || status === 'canceled';
}

function pullIssueAction(key: string, label = 'pull the result'): NextAction {
  const [projectId, iid] = key.split(':');
  return { label, command: `sync-cli pull-issue <name> ${projectId} ${iid}` };
}

function pushIssueAction(key: string): NextAction {
  const [projectId, iid] = key.split(':');
  return { label: 'push the issue to start the pipeline', command: `sync-cli push-issue <name> ${projectId} ${iid}` };
}

// Synthesizes one combined label per task from whichever signals are
// present — this is the actual "merged view," versus just listing each
// side's raw fields next to each other. Reports' own `step` is the fullest
// single-file record of an issue's lifecycle when it's there; gitlab-worker
// + agent-runner's dedup hash are the best available signal when it isn't
// (e.g. this machine only runs sync-cli, not reports). Without --live
// (IMPROVEMENTS_HARNESS.md 1.1/1.2), this is all local-only — "ready to
// pull" is an inference from what was last pushed locally, not a fact about
// what's still on bridge, and a published task's pipeline is simply
// unknown. `live` (bridge) and `gitlabLive` (GitLab) are independent of
// each other — either, both, or neither may be configured on a given
// machine — and each attaches its own note (`liveNote`/`gitlabNote`)
// regardless of which branch below matched; `live` additionally upgrades
// one specific guess into a fact, and `gitlabLive` can override the
// 'published' label entirely when the pipeline behind it failed.
export function deriveStatus(
  task: TaskEntry,
  staleHours: number,
  now: number,
  live?: LiveTaskInfo,
  gitlabLive?: LiveGitlabTaskInfo,
): DerivedStatus {
  const s = task.subscription;
  const liveNote = liveNoteFor(live);
  const gitlabNote = gitlabNoteFor(gitlabLive);
  const withLiveNote = (status: DerivedStatus, nextAction?: NextAction): DerivedStatus => ({
    ...status,
    ...(liveNote ? { liveNote } : {}),
    ...(gitlabNote ? { gitlabNote } : {}),
    ...(nextAction ? { nextAction } : {}),
  });

  if (s) {
    switch (s.step) {
      case 'published':
        // The one case this item exists for: "published — done" was a
        // label harness could print with zero way to know it might be
        // wrong — a merged/open MR with a failed pipeline behind it is
        // exactly the gap (IMPROVEMENTS_HARNESS.md 1.2).
        return gitlabPipelineFailed(gitlabLive)
          ? withLiveNote(
              { label: `published — but pipeline failed (MR !${gitlabLive!.mergeRequest!.iid})`, stale: true },
              { label: `investigate the failing pipeline for MR !${gitlabLive!.mergeRequest!.iid}` },
            )
          : withLiveNote({ label: 'published — done', stale: false });
      case 'pulled': {
        const stale = Boolean(s.pulledAt) && hoursSince(s.pulledAt!, now) > staleHours;
        return withLiveNote(
          {
            label: stale ? `pulled ${s.pulledAt} — not yet published` : 'pulled — ready to publish',
            stale,
          },
          { label: 'publish the result (reports → Subscription → Publish)' },
        );
      }
      case 'pushed': {
        const stale = Boolean(s.pushedAt) && hoursSince(s.pushedAt!, now) > staleHours;
        return withLiveNote(
          {
            label: stale ? `pushed ${s.pushedAt} — no pull since` : 'pushed — waiting to be pulled',
            stale,
          },
          pullIssueAction(task.key, 'pull the result once it is ready'),
        );
      }
      default: {
        // 'init' is the only step left here — unlike pushed/pulled/
        // published, it has no step-specific timestamp of its own, so
        // staleness falls back to updatedAt (IMPROVEMENTS_HARNESS.md 6.3).
        // Absent on an entry written before this field existed, or one a
        // writer hasn't touched since — same "no signal, not stale" default
        // every other branch here already uses for a missing timestamp.
        const stale = Boolean(s.updatedAt) && hoursSince(s.updatedAt!, now) > staleHours;
        return withLiveNote(
          {
            label: stale ? `${s.step} ${s.updatedAt} — not yet pushed` : `${s.step} — not yet pushed`,
            stale,
          },
          pushIssueAction(task.key),
        );
      }
    }
  }

  if (task.gitlabWorker) {
    const stale = hoursSince(task.gitlabWorker.pushedAt, now) > staleHours;

    if (task.syncAgent) {
      if (live) {
        return live.hasResultInStorage
          ? withLiveNote(
              { label: 'agent-runner pushed a result — confirmed in bridge storage, ready to pull', stale: false },
              pullIssueAction(task.key),
            )
          : withLiveNote({
              label: 'agent-runner pushed a result locally, but bridge storage has no result yet',
              stale: false,
            });
      }
      return withLiveNote(
        { label: 'agent-runner already pushed a result back — likely ready to pull', stale: false },
        pullIssueAction(task.key, 'likely ready to pull — confirm with --live, or just try'),
      );
    }

    return withLiveNote({
      label: stale
        ? `pushed to bridge ${task.gitlabWorker.pushedAt} — still waiting on agent-runner`
        : 'pushed to bridge — waiting on agent-runner',
      stale,
    });
  }

  if (task.syncAgent) {
    return withLiveNote(
      { label: 'agent-runner has pushed at least one result (no gitlab-worker record for it)', stale: false },
      pullIssueAction(task.key),
    );
  }

  return withLiveNote({ label: 'no local state', stale: false });
}

export function annotateTasks(
  tasks: TaskEntry[],
  staleHours: number,
  now: number = Date.now(),
  liveTasks?: Map<string, LiveTaskInfo>,
  gitlabLiveTasks?: Map<string, LiveGitlabTaskInfo>,
): AnnotatedTaskEntry[] {
  return tasks.map((task) => ({
    ...task,
    status: deriveStatus(task, staleHours, now, liveTasks?.get(task.key), gitlabLiveTasks?.get(task.key)),
  }));
}

// Non-zero when there's something actionable to see: a malformed state
// file, or a task whose derived status came back stale — lets pipe-status
// double as a cron/CI health check, not only something a human has to read.
export function exitCodeFor(data: AnnotatedReportData): number {
  const hasStaleTask = data.tasks.some((task) => task.status.stale);
  return data.errors.length > 0 || hasStaleTask ? 1 : 0;
}
