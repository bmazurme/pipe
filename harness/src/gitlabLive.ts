import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getIssue, listAssignedOpenIssues, listMergeRequestsForBranch } from '@pipe/protocol';

import type { TaskEntry } from './collect.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYNC_ROOT = path.resolve(__dirname, '..', '..', 'sync');

// Same reasoning and shape as bridgeLive.ts's own credential loading
// (IMPROVEMENTS_HARNESS.md 1.1) — reuses sync-cli's own GitLab token/apiUrl
// rather than inventing a third place to configure this (IMPROVEMENTS_HARNESS.md
// 1.2/1.3). Independent of bridgeLive.ts's own availability — a machine can
// have one configured without the other.
export interface GitlabLiveConfigPaths {
  syncCredentials: string;
  syncConfig: string;
}

export const DEFAULT_GITLAB_LIVE_CONFIG_PATHS: GitlabLiveConfigPaths = {
  syncCredentials: path.join(SYNC_ROOT, '.sync-credentials.json'),
  syncConfig: path.join(SYNC_ROOT, 'sync.config.json'),
};

export interface GitlabLiveConfig {
  apiUrl: string;
  token: string;
}

export function loadGitlabLiveConfig(
  paths: GitlabLiveConfigPaths = DEFAULT_GITLAB_LIVE_CONFIG_PATHS,
): GitlabLiveConfig | undefined {
  if (!existsSync(paths.syncCredentials) || !existsSync(paths.syncConfig)) return undefined;

  const credentials = JSON.parse(readFileSync(paths.syncCredentials, 'utf-8')) as { gitlabToken?: string };
  if (!credentials.gitlabToken) return undefined;

  const config = JSON.parse(readFileSync(paths.syncConfig, 'utf-8')) as { gitlab?: { apiUrl?: string } };
  if (!config.gitlab?.apiUrl) return undefined;

  return { apiUrl: config.gitlab.apiUrl, token: credentials.gitlabToken };
}

// reports' own subscription.branch is authoritative when it's there;
// otherwise, for a task gitlab-worker pushed, its synthetic
// `task/<projectId>-<iid>` naming (gitlabWorker.ts's syntheticBranchName)
// is the only branch we can infer without yet another live call. A task
// with neither signal has no branch to check at all.
export function resolveTaskBranch(task: TaskEntry): string | undefined {
  if (task.subscription?.branch) return task.subscription.branch;
  if (task.gitlabWorker) {
    const [projectId, iid] = task.key.split(':');
    return `task/${projectId}-${iid}`;
  }
  return undefined;
}

export interface LiveGitlabTaskInfo {
  issueState?: string;
  mergeRequest?: { iid: number; state: string; pipelineStatus: string | null };
}

export interface IncomingIssue {
  key: string;
  projectId: number;
  iid: number;
  title: string;
}

export interface GitlabLiveData {
  tasks: Map<string, LiveGitlabTaskInfo>;
  incoming: IncomingIssue[];
}

export type GitlabLiveStatusResult = { available: true; data: GitlabLiveData } | { available: false; reason: string };

async function fetchTaskGitlabInfo(config: GitlabLiveConfig, projectId: string, iid: string, branch: string): Promise<LiveGitlabTaskInfo> {
  const [issue, mrs] = await Promise.all([
    getIssue(config.apiUrl, config.token, projectId, iid),
    listMergeRequestsForBranch(config.apiUrl, config.token, projectId, branch),
  ]);

  // order_by=updated_at (GitLab's default sort for that is descending) —
  // the most recently active MR for this branch, if more than one somehow
  // exists.
  const newest = mrs[0];

  return {
    issueState: issue.state,
    ...(newest ? { mergeRequest: { iid: newest.iid, state: newest.state, pipelineStatus: newest.pipeline?.status ?? null } } : {}),
  };
}

// Never throws — same "errors as data" convention as bridgeLive.ts. Only
// listAssignedOpenIssues failing (bad token, network) makes the whole
// result unavailable; one task's own getIssue/listMergeRequestsForBranch
// failing (a deleted issue, a permissions change) just leaves that one task
// without GitLab info instead of losing every other task's too.
export async function fetchGitlabLiveStatus(
  tasks: TaskEntry[],
  paths: GitlabLiveConfigPaths = DEFAULT_GITLAB_LIVE_CONFIG_PATHS,
): Promise<GitlabLiveStatusResult> {
  const config = loadGitlabLiveConfig(paths);
  if (!config) {
    return {
      available: false,
      reason: 'no GitLab token configured for sync-cli — run "sync-cli login-gitlab <token>" once (see sync/README.md)',
    };
  }

  let assigned;
  try {
    assigned = await listAssignedOpenIssues(config.apiUrl, config.token);
  } catch (error) {
    return { available: false, reason: `GitLab live check failed: ${(error as Error).message}` };
  }

  const tasksWithBranch = tasks
    .map((task) => ({ task, branch: resolveTaskBranch(task) }))
    .filter((entry): entry is { task: TaskEntry; branch: string } => Boolean(entry.branch));

  const settled = await Promise.allSettled(
    tasksWithBranch.map(({ task, branch }) => {
      const [projectId, iid] = task.key.split(':');
      return fetchTaskGitlabInfo(config, projectId, iid, branch);
    }),
  );

  const taskInfo = new Map<string, LiveGitlabTaskInfo>();
  tasksWithBranch.forEach(({ task }, index) => {
    const result = settled[index];
    if (result.status === 'fulfilled') taskInfo.set(task.key, result.value);
  });

  const knownTaskKeys = new Set(tasks.map((task) => task.key));
  const incoming = assigned
    .filter((issue) => !knownTaskKeys.has(`${issue.project_id}:${issue.iid}`))
    .map((issue) => ({ key: `${issue.project_id}:${issue.iid}`, projectId: issue.project_id, iid: issue.iid, title: issue.title }));

  return { available: true, data: { tasks: taskInfo, incoming } };
}
