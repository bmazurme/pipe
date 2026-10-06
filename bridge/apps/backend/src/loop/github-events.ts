import { LOOP_BRANCH_PREFIX, LoopStage } from './entities/loop-run.entity';

// What a GitHub webhook delivery means for the loop — computed purely from the
// payload so the mapping is unit-testable without a database or Telegram.
export interface GithubInterpretation {
  // Stored as LoopEvent.type.
  type: string;
  message: string;
  // How to find the run this event belongs to, strongest signal first.
  runId?: number;
  prNumber?: number;
  // A deploy workflow runs on main, not on the run's branch — so it is
  // matched to the newest run waiting in the Deploying stage instead.
  matchDeploying?: boolean;
  // Absent = record/notify only, leave the run's stage alone.
  stage?: LoopStage;
  // undefined = leave unchanged, null = clear.
  error?: string | null;
  branch?: string;
  // Notify even when no run matched (a deploy is worth hearing about no
  // matter who triggered it; a CI run on some unrelated branch is not).
  notifyUnmatched: boolean;
  // A loop PR that no run knows about yet (reports opens PRs from its own
  // branch names, so the branch can't carry a run id) becomes a run of its own.
  adopt?: { title: string };
  // CI went green on a PR: instead of a plain notification, check it and
  // offer the owner a merge button (see MergeService.offer).
  offerMerge?: boolean;
}

// A PR is the loop's business when it sits on a loop branch OR carries this
// label — reports opens PRs from the task branch it created, then labels them.
export const LOOP_PR_LABEL = 'loop';

export interface GithubWorkflowNames {
  ci: string;
  deploy: string;
}

interface PullRequestPayload {
  action?: string;
  label?: { name?: string };
  pull_request?: {
    number?: number;
    title?: string;
    merged?: boolean;
    head?: { ref?: string; repo?: { full_name?: string } | null };
    base?: { repo?: { full_name?: string } | null };
    author_association?: string;
    labels?: Array<{ name?: string }>;
  };
}

// The repository is public, so anyone can open a PR (or one from a fork) with
// a `loop/` branch or the `loop` label. Only PRs from this repository's own
// branches, authored by someone with write-level standing, may enter the loop
// — everything else is ignored as if the webhook never fired. Missing fields
// fail closed: GitHub always sends them, so their absence means a forged or
// malformed payload.
const TRUSTED_AUTHOR_ASSOCIATIONS = new Set([
  'OWNER',
  'MEMBER',
  'COLLABORATOR',
]);

function isTrustedPullRequest(
  pr: NonNullable<PullRequestPayload['pull_request']>,
) {
  const head = pr.head?.repo?.full_name;
  const base = pr.base?.repo?.full_name;

  return (
    !!head &&
    head === base &&
    TRUSTED_AUTHOR_ASSOCIATIONS.has(pr.author_association ?? '')
  );
}

interface WorkflowRunPayload {
  action?: string;
  repository?: { full_name?: string } | null;
  workflow_run?: {
    name?: string;
    conclusion?: string | null;
    head_branch?: string;
    head_repository?: { full_name?: string } | null;
    html_url?: string;
    pull_requests?: Array<{ number?: number }>;
  };
}

export function parseRunIdFromBranch(
  branch: string | undefined,
): number | undefined {
  if (!branch?.startsWith(LOOP_BRANCH_PREFIX)) {
    return undefined;
  }

  const match = /^(\d+)/.exec(branch.slice(LOOP_BRANCH_PREFIX.length));

  return match ? Number(match[1]) : undefined;
}

export function interpretGithubEvent(
  event: string,
  payload: unknown,
  workflows: GithubWorkflowNames,
): GithubInterpretation | null {
  if (event === 'pull_request') {
    return interpretPullRequest(payload as PullRequestPayload);
  }

  if (event === 'workflow_run') {
    return interpretWorkflowRun(payload as WorkflowRunPayload, workflows);
  }

  return null;
}

function interpretPullRequest(
  payload: PullRequestPayload,
): GithubInterpretation | null {
  const pr = payload.pull_request;
  const branch = pr?.head?.ref;

  if (!pr || !isTrustedPullRequest(pr)) {
    return null;
  }

  const hasLoopLabel = pr?.labels?.some((l) => l.name === LOOP_PR_LABEL);

  if (
    !pr?.number ||
    !(branch?.startsWith(LOOP_BRANCH_PREFIX) || hasLoopLabel)
  ) {
    // `labeled` is how a PR that was opened without labels (the usual case
    // for reports) first becomes visible to the loop: the payload's own label
    // list is read from the PR, but be explicit about the label just added.
    if (!(
      pr?.number &&
      payload.action === 'labeled' &&
      payload.label?.name === LOOP_PR_LABEL
    )) {
      return null;
    }
  }

  const base = {
    runId: parseRunIdFromBranch(branch),
    prNumber: pr.number,
    branch,
    notifyUnmatched: false,
  };
  const label = `PR #${pr.number}${pr.title ? ` «${pr.title}»` : ''}`;

  if (
    payload.action === 'opened' ||
    payload.action === 'reopened' ||
    payload.action === 'labeled'
  ) {
    return {
      ...base,
      // Only an opening PR can start a run — a merged/closed one with no run
      // behind it is just history, not something to start tracking.
      adopt: { title: pr.title ?? `PR #${pr.number}` },
      type: `pull_request.${payload.action}`,
      stage: LoopStage.PrOpen,
      error: null,
      message: `🔀 ${label} открыт — ждём CI`,
    };
  }

  if (payload.action === 'closed' && pr.merged) {
    return {
      ...base,
      type: 'pull_request.merged',
      stage: LoopStage.Deploying,
      error: null,
      message: `✅ ${label} влит в main — ждём деплой`,
    };
  }

  if (payload.action === 'closed') {
    return {
      ...base,
      type: 'pull_request.closed',
      stage: LoopStage.Failed,
      error: 'PR closed without merge',
      message: `🚫 ${label} закрыт без merge`,
    };
  }

  return null;
}

function interpretWorkflowRun(
  payload: WorkflowRunPayload,
  workflows: GithubWorkflowNames,
): GithubInterpretation | null {
  const run = payload.workflow_run;

  if (payload.action !== 'completed' || !run?.name) {
    return null;
  }

  const link = run.html_url ? `\n${run.html_url}` : '';
  const ok = run.conclusion === 'success';

  if (run.name === workflows.ci) {
    // A CI run triggered by a fork's PR is not the loop's business (and must
    // never produce a merge offer) — same rule as isTrustedPullRequest.
    const repo = payload.repository?.full_name;

    if (!repo || run.head_repository?.full_name !== repo) {
      return null;
    }

    return {
      type: `workflow_run.ci.${run.conclusion ?? 'unknown'}`,
      runId: parseRunIdFromBranch(run.head_branch),
      prNumber: run.pull_requests?.[0]?.number,
      stage: LoopStage.Ci,
      offerMerge: ok,
      error: ok ? null : `CI ${run.conclusion ?? 'unknown'}`,
      message: ok
        ? `🟢 CI зелёный на ${run.head_branch} — можно мержить${link}`
        : `🔴 CI ${run.conclusion ?? 'unknown'} на ${run.head_branch}${link}`,
      notifyUnmatched: false,
    };
  }

  if (run.name === workflows.deploy) {
    return {
      type: `workflow_run.deploy.${run.conclusion ?? 'unknown'}`,
      matchDeploying: true,
      // The deploy workflow runs its own smoke test, so a green deploy is
      // also a verified one.
      stage: ok ? LoopStage.Done : LoopStage.Failed,
      error: ok ? null : `Deploy ${run.conclusion ?? 'unknown'}`,
      message: ok
        ? `🚀 Деплой прошёл (smoke ок)${link}`
        : `🔴 Деплой ${run.conclusion ?? 'unknown'}${link}`,
      notifyUnmatched: true,
    };
  }

  return null;
}
