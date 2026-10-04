import type { LiveWorkerInfo } from './bridgeLive.js';
import { collectReportData, type StatusPaths, type SyncState } from './collect.js';
import { annotateTasks, DEFAULT_STALE_HOURS, type AnnotatedReportData, type AnnotatedTaskEntry } from './deriveStatus.js';

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

// liveWorker/liveError come from --live (IMPROVEMENTS_HARNESS.md 1.1,
// bridgeLive.ts's fetchLiveStatus) — both omitted in the default, offline
// mode, which keeps printing the same static line as before this existed.
export function formatReportText(
  data: AnnotatedReportData,
  liveWorker?: LiveWorkerInfo,
  liveError?: string,
): string {
  const lines = [
    ...data.errors,
    ...formatProjectSyncSection(data.syncState),
    ...formatTaskSection(data.tasks),
    ...formatBridgeSection(liveWorker, liveError),
  ];

  return lines.join('\n');
}

export function buildReport(paths: StatusPaths, staleHours: number = DEFAULT_STALE_HOURS): string {
  const data = collectReportData(paths);
  return formatReportText({ ...data, tasks: annotateTasks(data.tasks, staleHours) });
}
