import type { LiveClaudeCredential, LiveWorkerInfo } from './bridgeLive.js';
import { collectReportData, type StatusPaths, type SyncState } from './collect.js';
import { annotateTasks, DEFAULT_STALE_HOURS, type AnnotatedReportData, type AnnotatedTaskEntry } from './deriveStatus.js';
import type { IncomingIssue } from './gitlabLive.js';
import type { SyncStateEntry } from '@pipe/protocol/state';

function formatHoursAgo(hours: number): string {
  if (hours < 1) return `${Math.max(0, Math.round(hours * 60))}m ago`;
  return `${Math.round(hours)}h ago`;
}

// A hash tells the user nothing they can act on — "last synced N ago" does
// (IMPROVEMENTS_HARNESS.md 6.4). Falls back to the hash for an entry
// written before setLastHash() started stamping lastSyncedAt — same
// "no signal, say so plainly" convention deriveStatus.ts already uses for
// a missing timestamp, rather than pretending to know an age it doesn't.
function describeSyncEntry(entry: SyncStateEntry, now: number): string {
  if (!entry.lastSyncedAt) return `lastHash ${entry.lastHash.slice(0, 12)}… (synced before timestamps were recorded)`;
  return `last synced ${formatHoursAgo((now - Date.parse(entry.lastSyncedAt)) / (60 * 60 * 1000))}`;
}

function formatProjectSyncSection(state: SyncState, now: number): string[] {
  const lines = ['== sync: project push/pull state (.sync-state.json) =='];
  const entries = Object.entries(state);

  if (entries.length === 0) {
    lines.push('  no state yet');
  } else {
    for (const [project, entry] of entries) {
      lines.push(`  ${project}: ${describeSyncEntry(entry, now)}`);
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
    if (task.status.nextAction) {
      const { label, command } = task.status.nextAction;
      lines.push(`    next: ${label}${command ? ` → ${command}` : ''}`);
    }

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

// IMPROVEMENTS_HARNESS.md 1.5 ("assistant resources") — only the Claude
// credential names configured on this account, under --live, from the
// same bridgeLive.ts call already made for the worker/task sections
// above. VPN panel status is deliberately NOT here: /api/v1/vpn/* is
// JwtGuard-only (browser session), not reachable with sync-cli's bridge
// API key the way worker/storage/jobs are — see bridgeLive.ts's own
// LiveData.claudeCredentials comment for why widening that guard wasn't
// the right call just for a status display. Worker up/down is already in
// formatBridgeSection above, so isn't repeated here.
function formatEnvironmentSection(claudeCredentials: LiveClaudeCredential[] | undefined): string[] {
  if (!claudeCredentials) return [];

  const lines = ['', '== environment (live) =='];
  if (claudeCredentials.length === 0) {
    lines.push('  no Claude credentials configured (see bridge → Worker page)');
  } else {
    for (const credential of claudeCredentials) {
      lines.push(`  claude credential: ${credential.name} (added ${credential.createdAt})`);
    }
  }
  return lines;
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
  claudeCredentials?: LiveClaudeCredential[],
  incoming?: IncomingIssue[],
  gitlabError?: string,
  now: number = Date.now(),
): string {
  const lines = [
    ...data.errors,
    ...formatProjectSyncSection(data.syncState, now),
    ...formatIncomingSection(incoming, gitlabError),
    ...formatTaskSection(data.tasks),
    ...formatBridgeSection(liveWorker, liveError),
    ...formatEnvironmentSection(claudeCredentials),
  ];

  return lines.join('\n');
}

export function buildReport(paths: StatusPaths, staleHours: number = DEFAULT_STALE_HOURS): string {
  const now = Date.now();
  const data = collectReportData(paths);
  return formatReportText(
    { ...data, tasks: annotateTasks(data.tasks, staleHours, now) },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    now,
  );
}
