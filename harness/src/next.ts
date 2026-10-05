import type { LiveTaskInfo } from './bridgeLive.js';
import { compareIssueKeys } from './collect.js';
import { pushIssueAction, type AnnotatedTaskEntry, type NextAction } from './deriveStatus.js';
import type { IncomingIssue } from './gitlabLive.js';

// IMPROVEMENTS_HARNESS.md 2.2 — "одна самая важная задача прямо сейчас и
// что с ней сделать." The doc's own scoring is a loose order (зависла >
// есть готовый результат > новая назначенная > в работе); mapped here onto
// signals pipe-status already collects, no new data source:
//
//   1. stale    — deriveStatus already flagged it (stuck past --stale-after,
//                 or a published task whose pipeline actually failed).
//   2. ready    — a CONFIRMED ready result: reports' own 'pulled' step
//                 (local, no live needed — publishing is the only thing
//                 left), or a gitlabWorker+agent-runner task --live has
//                 confirmed has a result in bridge storage. Deliberately
//                 NOT the unconfirmed "likely ready to pull" guess — that
//                 one stays in bucket 4 until it's either confirmed or
//                 goes stale.
//   3. incoming — a GitLab issue assigned to you that no local state file
//                 has picked up at all yet (gitlabLive.ts's own 1.3) —
//                 only visible under --live, same as that section already is.
//   4. other    — anything else with a next action at all (deriveStatus
//                 omits nextAction entirely once there's truly nothing to
//                 do — a done published task, or no local state).
//
// Explicitly NOT done here, despite the original doc text mentioning it:
// weighting by GitLab due date / priority labels. gitlabLive.ts's own
// GitLab calls (1.2/1.3) don't fetch either field today — adding them
// means extending @pipe/protocol/gitlabClient's GitlabIssue shape and its
// API calls, a separate, not-necessarily-cheap follow-up, not folded into
// this pass.
export type NextBucket = 'stale' | 'ready' | 'incoming' | 'other';

export interface NextRecommendation {
  key: string;
  bucket: NextBucket;
  label: string;
  nextAction?: NextAction;
}

function isConfirmedReady(task: AnnotatedTaskEntry, liveTasks: Map<string, LiveTaskInfo> | undefined): boolean {
  if (task.subscription?.step === 'pulled') return true;
  return Boolean(task.gitlabWorker && task.syncAgent && liveTasks?.get(task.key)?.hasResultInStorage);
}

function firstByKey<T extends { key: string }>(items: T[]): T | undefined {
  return [...items].sort((a, b) => compareIssueKeys(a.key, b.key))[0];
}

export function pickNextTask(
  tasks: AnnotatedTaskEntry[],
  incoming: IncomingIssue[] = [],
  liveTasks?: Map<string, LiveTaskInfo>,
): NextRecommendation | undefined {
  const stale = firstByKey(tasks.filter((task) => task.status.stale));
  if (stale) {
    return { key: stale.key, bucket: 'stale', label: stale.status.label, nextAction: stale.status.nextAction };
  }

  const ready = firstByKey(tasks.filter((task) => isConfirmedReady(task, liveTasks)));
  if (ready) {
    return { key: ready.key, bucket: 'ready', label: ready.status.label, nextAction: ready.status.nextAction };
  }

  const nextIncoming = firstByKey(incoming);
  if (nextIncoming) {
    return {
      key: nextIncoming.key,
      bucket: 'incoming',
      label: `assigned, not yet pushed: ${nextIncoming.title}`,
      nextAction: pushIssueAction(nextIncoming.key),
    };
  }

  const inProgress = firstByKey(tasks.filter((task) => task.status.nextAction));
  if (inProgress) {
    return { key: inProgress.key, bucket: 'other', label: inProgress.status.label, nextAction: inProgress.status.nextAction };
  }

  return undefined;
}

// Shared between cli.ts's --next and the MCP server's `next` tool
// (IMPROVEMENTS_HARNESS.md 5.1) — one text rendering, not two copies.
export function formatNextRecommendation(picked: NextRecommendation | undefined): string {
  if (!picked) return 'Nothing urgent — all clear.';

  const lines = [`${picked.key} [${picked.bucket}]: ${picked.label}`];
  if (picked.nextAction) {
    lines.push(`  next: ${picked.nextAction.label}${picked.nextAction.command ? ` → ${picked.nextAction.command}` : ''}`);
  }
  return lines.join('\n');
}
