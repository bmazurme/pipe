import type { SubscriptionStateEntryType } from '@reports/shared';

import { currentBranch, stashChanges } from './git';
import { getIssueState, setIssueState } from './state-props';
import { workTreeFor } from './work-tree';

export interface ResetResult {
  state: SubscriptionStateEntryType;
  // The files of the received result were put into `git stash` (not deleted).
  stashed: boolean;
}

// Takes a task back to the start after a result that did not come out as wanted: its progress (pushed / pulled / published) is
// forgotten, the task keeps its branch and can be pushed again from the first step.
//
// What it does NOT do: it does not touch GitLab (a comment already published stays there) and it does not rewrite commits (the
// unattended autopilot commits what it pulls). With `discardFiles` the files the pull left UNCOMMITTED in the task's working tree
// are put into `git stash` — not deleted — so they can be brought back; that only happens when the repository is on the task's own
// branch, never on someone else's work.
export async function resetSubscriptionIssue(
  projectId: string,
  iid: string,
  options: { discardFiles?: boolean } = {},
): Promise<ResetResult> {
  const state = getIssueState(projectId, iid);

  if (!state) throw new Error('У задачи нет прогресса — сбрасывать нечего');
  if (state.step !== 'pulled' && state.step !== 'published') {
    throw new Error('Сбросить прогресс можно после получения результата (шаг Pull); до этого его можно просто отправить заново');
  }

  let stashed = false;

  if (options.discardFiles && state.branch) {
    const workTree = workTreeFor(projectId);

    if ((await currentBranch(workTree.path)) === state.branch) {
      stashed = await stashChanges(workTree.path, `reports: результат задачи ${iid} (сброс прогресса)`);
    }
  }

  const next = setIssueState(projectId, iid, {
    step: 'init',
    pushedAt: undefined,
    pulledAt: undefined,
    publishedAt: undefined,
    pulledFiles: undefined,
    parcelId: undefined,
    encrypted: undefined,
  });

  return { state: next, stashed };
}
