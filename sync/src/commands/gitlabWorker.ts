import { notify } from '@pipe/protocol/notify';

import { findProject, loadConfig } from '../config.js';
import { loadCredentialsOrEmpty } from '../credentials.js';
import { issueKey, loadGitlabWorkerState, recordPushed } from '../gitlabWorkerState.js';
import { listAssignedOpenIssues, type GitlabIssue } from '../gitlabClient.js';
import type { ProjectConfig, SyncConfig } from '../types.js';
import { buildAndUploadIssueParcel } from './pushIssue.js';
import { log } from '../log.js';

// No git branch/worktree operation happens here on purpose: agent-runner
// already creates the actual task branch itself, in its own worktree, from
// the project's baseBranch once a parcel arrives (see
// commands/agentRunner.ts, addTaskWorktree) — the manifest's branch field is
// just an addressing label. This only has to snapshot the tracked project's
// current on-disk content, exactly like push-issue already does.
function syntheticBranchName(issue: GitlabIssue): string {
  return `task/${issue.project_id}-${issue.iid}`;
}

function belongsToTrackedProject(issue: GitlabIssue, project: ProjectConfig): boolean {
  return !project.gitlabProjectId || String(issue.project_id) === project.gitlabProjectId;
}

async function processIssue(
  issue: GitlabIssue,
  project: ProjectConfig,
  config: SyncConfig,
  gitlabToken: string,
  options: { strict?: boolean },
): Promise<void> {
  const key = issueKey(issue.project_id, issue.iid);
  const branch = syntheticBranchName(issue);

  const result = await buildAndUploadIssueParcel(project, config, issue, branch, gitlabToken, options);
  if (!result) return;

  recordPushed(key, result.filename);
  log.info(
    `Pushed issue #${issue.iid} (project ${issue.project_id}) as "${result.filename}" ` +
      `(${result.fileCount} files, branch "${branch}"${result.encrypted ? ', encrypted' : ''}).`,
  );
  notify('Task pushed', `#${issue.iid}: ${issue.title} — sent to bridge for agent-runner`);
}

const MAX_BACKOFF_MS = 60 * 60 * 1000;

export type PushBackoff = Map<string, { failures: number; nextAttemptAt: number }>;

// `backoff` is only passed by --watch; without it every tick retries as before.
export async function runGitlabWorkerOnce(
  name: string,
  options: { strict?: boolean } = {},
  backoff?: PushBackoff,
  { intervalMs = 0, now = Date.now }: { intervalMs?: number; now?: () => number } = {},
): Promise<void> {
  const config = loadConfig();
  const project = findProject(config, name);

  if (!config.gitlab?.apiUrl) {
    throw new Error(
      'GitLab is not configured — add "gitlab": { "apiUrl": "https://<host>/api/v4" } to sync.config.json.',
    );
  }

  const { gitlabToken } = loadCredentialsOrEmpty();
  if (!gitlabToken) {
    throw new Error('Not logged in to GitLab. Run "sync-cli login-gitlab <token>" first.');
  }

  const issues = await listAssignedOpenIssues(config.gitlab.apiUrl, gitlabToken);
  const state = loadGitlabWorkerState();

  if (backoff) {
    const assigned = new Set(issues.map((issue) => issueKey(issue.project_id, issue.iid)));
    for (const key of backoff.keys()) {
      if (!assigned.has(key)) backoff.delete(key);
    }
  }

  const newIssues = issues.filter(
    (issue) => belongsToTrackedProject(issue, project) && !state[issueKey(issue.project_id, issue.iid)],
  );

  if (newIssues.length === 0) {
    log.info(`No new assigned open issues for "${name}".`);
    return;
  }

  for (const issue of newIssues) {
    const key = issueKey(issue.project_id, issue.iid);
    const entry = backoff?.get(key);
    if (entry && now() < entry.nextAttemptAt) continue;

    try {
      await processIssue(issue, project, config, gitlabToken, options);
      backoff?.delete(key);
    } catch (error) {
      const message = (error as Error).message;
      log.error(`Error pushing issue #${issue.iid} (project ${issue.project_id}): ${message}`);
      if (!backoff) continue;

      const failures = (entry?.failures ?? 0) + 1;
      const delayMs = Math.min(intervalMs * 2 ** (failures - 1), MAX_BACKOFF_MS);
      backoff.set(key, { failures, nextAttemptAt: now() + delayMs });
      if (failures === 1) notify('Task push failed', `#${issue.iid}: ${message}`);
      log.info(`Issue #${issue.iid}: retrying in ${Math.round(delayMs / 60000)} min after ${failures} failures`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function gitlabWorkerCommand(
  name: string,
  options: { watch?: string; strict?: boolean },
): Promise<void> {
  if (!options.watch) {
    await runGitlabWorkerOnce(name, options);
    return;
  }

  const intervalSec = Number(options.watch);
  if (!Number.isFinite(intervalSec) || intervalSec <= 0) {
    throw new Error(`--watch expects a positive number of seconds, got "${options.watch}".`);
  }

  log.info(`Watching GitLab for new assigned issues every ${intervalSec}s. Ctrl+C to stop.`);
  const backoff: PushBackoff = new Map();
  for (;;) {
    await runGitlabWorkerOnce(name, options, backoff, { intervalMs: intervalSec * 1000 }).catch((error: unknown) => {
      log.error(error instanceof Error ? error.message : error);
    });
    await sleep(intervalSec * 1000);
  }
}
