import { findProject, loadConfig } from '../config.js';
import { loadCredentialsOrEmpty } from '../credentials.js';
import { issueKey, loadGitlabWorkerState, recordPushed } from '../gitlabWorkerState.js';
import { listAssignedOpenIssues, type GitlabIssue } from '../gitlabClient.js';
import { notify } from '../notify.js';
import type { ProjectConfig, SyncConfig } from '../types.js';
import { buildAndUploadIssueParcel } from './pushIssue.js';

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
): Promise<void> {
  const key = issueKey(issue.project_id, issue.iid);
  const branch = syntheticBranchName(issue);

  const result = await buildAndUploadIssueParcel(project, config, issue, branch, gitlabToken);
  if (!result) return;

  recordPushed(key, result.filename);
  console.log(
    `Pushed issue #${issue.iid} (project ${issue.project_id}) as "${result.filename}" ` +
      `(${result.fileCount} files, branch "${branch}"${result.encrypted ? ', encrypted' : ''}).`,
  );
  notify('Task pushed', `#${issue.iid}: ${issue.title} — sent to bridge for agent-runner`);
}

export async function runGitlabWorkerOnce(name: string): Promise<void> {
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

  const newIssues = issues.filter(
    (issue) => belongsToTrackedProject(issue, project) && !state[issueKey(issue.project_id, issue.iid)],
  );

  if (newIssues.length === 0) {
    console.log(`No new assigned open issues for "${name}".`);
    return;
  }

  for (const issue of newIssues) {
    try {
      await processIssue(issue, project, config, gitlabToken);
    } catch (error) {
      console.error(`Error pushing issue #${issue.iid} (project ${issue.project_id}): ${(error as Error).message}`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function gitlabWorkerCommand(name: string, options: { watch?: string }): Promise<void> {
  if (!options.watch) {
    await runGitlabWorkerOnce(name);
    return;
  }

  const intervalSec = Number(options.watch);
  if (!Number.isFinite(intervalSec) || intervalSec <= 0) {
    throw new Error(`--watch expects a positive number of seconds, got "${options.watch}".`);
  }

  console.log(`Watching GitLab for new assigned issues every ${intervalSec}s. Ctrl+C to stop.`);
  for (;;) {
    await runGitlabWorkerOnce(name).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
    });
    await sleep(intervalSec * 1000);
  }
}
