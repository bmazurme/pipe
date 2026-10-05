import type { LiveWorkerInfo } from './bridgeLive.js';
import { collectReportData, type StatusPaths, type SyncState } from './collect.js';
import { annotateTasks, DEFAULT_STALE_HOURS, type AnnotatedReportData, type AnnotatedTaskEntry } from './deriveStatus.js';
import type { IncomingIssue } from './gitlabLive.js';

function formatProjectSyncSection(state: SyncState): string[] {
  const lines = ['== sync: project push/pull state (.sync-state.json) =='];
  const entries = Object.entries(state);

  if (entries.length === 0) {
    lines.push('  no state yet');
  } else {
    for (const [project, { lastHash }] of entries) {
      lines.push(`  ${project}: lastHash ${lastHash.slice(0, 12)}…`);
    }
  }

  lines.push('');
  return lines;
}

function formatTaskSection(tasks: AnnotatedTaskEntry[]): string[] {
  const lines = ['== task status (sync + reports subscription, by "projectId:iid") =='];

  if (tasks.length === 0) {
    lines.push('  no in-flight tasks', '');
    return lines;
  }

  for (const task of tasks) {
    lines.push(`  ${task.key}: ${task.status.label}${task.status.stale ? ' [stale]' : ''}`);
    if (task.status.liveNote) lines.push(`    bridge (live): ${task.status.liveNote}`);
    if (task.status.gitlabNote) lines.push(`    gitlab (live): ${task.status.gitlabNote}`);

    if (task.gitlabWorker) {
      lines.push(`    gitlab-worker: pushed ${task.gitlabWorker.pushedAt} as ${task.gitlabWorker.filename}`);
    }

    if (task.syncAgent) {
      lines.push(`    sync (agent-runner): last own output ${task.syncAgent.lastOwnOutputHash.slice(0, 12)}…`);
    } else if (!task.gitlabWorker) {
      lines.push('    sync: no local state');
    }

    if (task.subscription) {
      const s = task.subscription;
      const parts = [`step ${s.step}`];
      if (s.manual) parts.push(`[вручную] "${s.title ?? ''}"`);
      if (s.branch) parts.push(`branch ${s.branch}`);
      if (s.pushedAt) parts.push(`pushed ${s.pushedAt}`);
      if (s.pulledAt) parts.push(`pulled ${s.pulledAt}`);
      if (s.publishedAt) parts.push(`published ${s.publishedAt}`);
      if (s.encrypted) parts.push('encrypted');
      lines.push(`    reports (subscription): ${parts.join(', ')}`);
    } else {
      lines.push('    reports (subscription): no local state');
    }
  }

  lines.push('');
  return lines;
}

function formatBridgeSection(liveWorker: LiveWorkerInfo | undefined, liveError: string | undefined): string[] {
  if (liveWorker) {
    const lines = [`== bridge (live) ==`, `  worker: ${liveWorker.isUp ? 'up' : 'down'}`];
    for (const worker of liveWorker.workers) {
      lines.push(`    ${worker.name}: ${worker.isUp ? 'up' : 'down'}, last seen ${worker.lastSeenAt}`);
    }
    return lines;
  }

  if (liveError) {
    return ['== bridge (live) ==', `  ${liveError}`];
  }

  return ['== bridge ==', '  no local task state (storage relay only — see bridge/README.md)'];
}

// Only printed at all under --live with a working GitLab token — an empty
// offline report has no way to know about an issue nobody has pushed yet
// (IMPROVEMENTS_HARNESS.md 1.3), so there's no static fallback line the way
// formatBridgeSection has one for the fully-offline case.
function formatIncomingSection(incoming: IncomingIssue[] | undefined, gitlabError: string | undefined): string[] {
  if (incoming) {
    if (incoming.length === 0) return ['== incoming (assigned, not yet pushed) ==', '  none', ''];

    const lines = ['== incoming (assigned, not yet pushed) =='];
    for (const issue of incoming) {
      lines.push(`  ${issue.key}: ${issue.title}`);
    }
    lines.push('');
    return lines;
  }

  if (gitlabError) {
    return ['== incoming (live) ==', `  ${gitlabError}`, ''];
  }

  return [];
}

// liveWorker/liveError come from --live (IMPROVEMENTS_HARNESS.md 1.1,
// bridgeLive.ts's fetchLiveStatus); incoming/gitlabError from the same flag
// via gitlabLive.ts's fetchGitlabLiveStatus (1.2/1.3) — all omitted in the
// default, offline mode, which keeps printing the same output as before
// either existed.
export function formatReportText(
  data: AnnotatedReportData,
  liveWorker?: LiveWorkerInfo,
  liveError?: string,
  incoming?: IncomingIssue[],
  gitlabError?: string,
): string {
  const lines = [
    ...data.errors,
    ...formatProjectSyncSection(data.syncState),
    ...formatIncomingSection(incoming, gitlabError),
    ...formatTaskSection(data.tasks),
    ...formatBridgeSection(liveWorker, liveError),
  ];

  return lines.join('\n');
}

export function buildReport(paths: StatusPaths, staleHours: number = DEFAULT_STALE_HOURS): string {
  const data = collectReportData(paths);
  return formatReportText({ ...data, tasks: annotateTasks(data.tasks, staleHours) });
}
