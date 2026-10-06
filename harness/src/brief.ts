import type { LiveWorkerInfo } from './bridgeLive.js';
import type { StatusPaths } from './collect.js';
import { readRecentEvents, type EventsPaths, type TaskEvent } from './events.js';
import { rankTasks, type NextRecommendation } from './next.js';
import { formatTransitionNotification } from './notifyTransitions.js';
import { buildReportData } from './reportBuilder.js';

// IMPROVEMENTS_HARNESS.md 3.2 — "pipe brief": входящие, готово к
// проверке, зависло, что сделано вчера, worker. No new data source —
// every section reuses something else already built this session
// (rankTasks' own buckets for the first three, events.jsonl for the
// fourth, bridgeLive's worker status for the fifth). "VPN" from the
// original doc text is left out for the same reason 1.5's own
// environment section already left it out: its endpoints are
// JwtGuard-only (browser session), not reachable with sync-cli's bridge
// API key the way worker/storage/jobs are. "по расписанию — в
// уведомление или Telegram": the OS-notification half is cli.ts's own
// job (pairing --brief with the existing --notify, see its own comment)
// — Telegram/web-push delivery is a distinct, separate item (3.3, not
// started), not folded into this one.
export const DEFAULT_RECENT_HOURS = 24;

export interface BriefOptions {
  paths?: Partial<StatusPaths>;
  staleHours?: number;
  recentHours?: number;
  eventsPaths?: EventsPaths;
  now?: number;
}

export interface BriefSections {
  incoming: NextRecommendation[];
  ready: NextRecommendation[];
  stale: NextRecommendation[];
  recentEvents: TaskEvent[];
  liveWorker?: LiveWorkerInfo;
  liveError?: string;
  gitlabError?: string;
}

export async function buildBrief(options: BriefOptions = {}): Promise<BriefSections> {
  const now = options.now ?? Date.now();
  const built = await buildReportData({ paths: options.paths, live: true, staleHours: options.staleHours, now });

  const liveTasks = built.liveResult?.available ? built.liveResult.data.tasks : undefined;
  const incomingIssues = built.gitlabLiveResult?.available ? built.gitlabLiveResult.data.incoming : [];
  const ranked = rankTasks(built.data.tasks, incomingIssues, liveTasks);

  return {
    incoming: ranked.filter((item) => item.bucket === 'incoming'),
    ready: ranked.filter((item) => item.bucket === 'ready'),
    stale: ranked.filter((item) => item.bucket === 'stale'),
    recentEvents: readRecentEvents(options.recentHours ?? DEFAULT_RECENT_HOURS, now, options.eventsPaths),
    liveWorker: built.liveResult?.available ? built.liveResult.data.worker : undefined,
    liveError: built.liveResult && !built.liveResult.available ? built.liveResult.reason : undefined,
    gitlabError: built.gitlabLiveResult && !built.gitlabLiveResult.available ? built.gitlabLiveResult.reason : undefined,
  };
}

function formatTaskList(items: NextRecommendation[]): string[] {
  if (items.length === 0) return ['  none'];
  return items.map((item) => `  ${item.key}: ${item.label}`);
}

export function formatBrief(sections: BriefSections, recentHours: number = DEFAULT_RECENT_HOURS): string {
  const lines = ['== brief ==', ''];

  // incoming is GitLab-sourced (gitlabLiveResult) — bridge's own liveError
  // is unrelated and must not be shown here, same way an empty array from
  // an unavailable GitLab check (buildBrief defaults to []) must not be
  // confused with "confirmed nothing incoming."
  lines.push('Incoming (assigned, not yet pushed):');
  lines.push(...(sections.gitlabError ? [`  ${sections.gitlabError}`] : formatTaskList(sections.incoming)));
  lines.push('');

  lines.push('Ready to review:');
  lines.push(...formatTaskList(sections.ready));
  lines.push('');

  lines.push('Stale:');
  lines.push(...formatTaskList(sections.stale));
  lines.push('');

  lines.push(`Moved in the last ${recentHours}h:`);
  if (sections.recentEvents.length === 0) {
    lines.push('  none');
  } else {
    for (const event of sections.recentEvents) {
      const { title, message } = formatTransitionNotification(event);
      lines.push(`  ${title}: ${message}`);
    }
  }
  lines.push('');

  lines.push('Worker:');
  if (sections.liveWorker) {
    lines.push(`  ${sections.liveWorker.isUp ? 'up' : 'down'}`);
  } else {
    lines.push(`  ${sections.liveError ?? 'unknown (live check unavailable)'}`);
  }

  return lines.join('\n');
}

// A short, single-line version — for pairing --brief with --notify (see
// cli.ts), where an OS notification needs a glance-able body, not the
// full multi-section text above.
export function summarizeBrief(sections: BriefSections): string {
  const parts = [
    `${sections.incoming.length} incoming`,
    `${sections.ready.length} ready`,
    `${sections.stale.length} stale`,
    `${sections.recentEvents.length} moved recently`,
  ];
  if (sections.liveWorker) parts.push(`worker ${sections.liveWorker.isUp ? 'up' : 'down'}`);
  return parts.join(', ');
}
