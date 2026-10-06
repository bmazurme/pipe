import { findProtectedPaths, isAnalysisTitle } from './analysis';
import { findTrackedProject } from './config-props';
import { changedFiles } from './git';
import { addLabels, createPull, DEFAULT_GITHUB_LABEL, findOpenPull, getIssue } from './github-client';
import { getIssueState } from './state-props';

export const LOOP_PR_LABEL = 'loop';
export const NEEDS_REVIEW_LABEL = 'needs-human-review';

export type OpenedPullRequest = { number: number; url: string; created: boolean; protectedFiles: string[] };

// Opens (or finds) the PR for a pulled task branch. Never merges anything —
// the PR is only a proposal; merging is bridge's Telegram-approved step.
// Returns null where no PR belongs: not a GitHub project, a manual task, or an
// analysis (its branch only carries the throwaway backlog file).
export async function openPullRequestForTask(projectId: string, iid: string): Promise<OpenedPullRequest | null> {
  const project = findTrackedProject(projectId);
  const state = getIssueState(projectId, iid);

  if (project?.provider !== 'github' || !project.githubRepo || !state?.branch || state.manual || isAnalysisTitle(state.title)) {
    return null;
  }

  const { githubRepo } = project;
  const existing = await findOpenPull(githubRepo, state.branch);

  if (existing) {
    return { number: existing.number, url: existing.html_url, created: false, protectedFiles: [] };
  }

  const base = project.baseBranch || 'main';
  const issue = await getIssue(githubRepo, iid);
  // Computed locally from the branch — the PR's real file list is re-checked by
  // bridge at merge time; this only labels the PR so a human sees it early.
  const protectedFiles = findProtectedPaths(await changedFiles(project.path, base, state.branch));

  const body = [
    `Closes #${iid}`,
    '',
    `Automated by the pipe self-improvement loop (${project.githubLabel || DEFAULT_GITHUB_LABEL} issue → worker → this branch).`,
    ...(protectedFiles.length
      ? ['', `⚠️ Touches protected paths — this cannot be merged from Telegram, only manually on GitHub:`, ...protectedFiles.map((file) => `- \`${file}\``)]
      : []),
  ].join('\n');

  const pull = await createPull(githubRepo, { title: issue.title, head: state.branch, base, body });

  // Opened first, labeled second: bridge adopts the PR when the `loop` label
  // appears, so a failure between the two leaves an unlabeled PR the loop
  // ignores rather than one it half-tracks.
  await addLabels(githubRepo, pull.number, [LOOP_PR_LABEL, ...(protectedFiles.length ? [NEEDS_REVIEW_LABEL] : [])]);

  return { number: pull.number, url: pull.html_url, created: true, protectedFiles };
}
