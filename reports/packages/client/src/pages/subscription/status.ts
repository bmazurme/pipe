import type { SubscriptionIssueType, SubscriptionStepType } from '@reports/shared';

export type StatusFilter = 'all' | 'new' | 'active' | 'done';

export const STEP_TITLES: Record<SubscriptionStepType, string> = {
  init: 'Ветка создана',
  pushed: 'Ждём результат',
  pulled: 'Получено из bridge',
  published: 'Опубликовано',
};

export const STEP_BADGE_THEME: Record<SubscriptionStepType, 'info' | 'warning' | 'success' | 'normal'> = {
  init: 'info',
  pushed: 'warning',
  pulled: 'info',
  published: 'success',
};

export function statusGroup(issue: SubscriptionIssueType): Exclude<StatusFilter, 'all'> {
  if (!issue.subscription) return 'new';

  return issue.subscription.step === 'published' ? 'done' : 'active';
}

// Case-insensitive match on the number, title and project — the three things
// a person actually remembers a task by.
export function matchesQuery(issue: SubscriptionIssueType, query: string): boolean {
  const needle = query.trim().toLowerCase();

  if (!needle) return true;

  return [issue.iid, issue.title, issue.projectName].some((part) => part.toLowerCase().includes(needle));
}

export function filterIssues(
  issues: SubscriptionIssueType[],
  filter: StatusFilter,
  query: string,
): SubscriptionIssueType[] {
  return issues.filter((issue) => (filter === 'all' || statusGroup(issue) === filter) && matchesQuery(issue, query));
}

export function countByGroup(issues: SubscriptionIssueType[]): Record<StatusFilter, number> {
  const counts: Record<StatusFilter, number> = { all: issues.length, new: 0, active: 0, done: 0 };

  issues.forEach((issue) => {
    counts[statusGroup(issue)] += 1;
  });

  return counts;
}

export type IssueGroup = { projectName: string; issues: SubscriptionIssueType[] };

// Groups by repository, keeping both the order repositories first appear in
// and the order of issues inside each one (the server already sorts them).
export function groupByProject(issues: SubscriptionIssueType[]): IssueGroup[] {
  const groups = new Map<string, IssueGroup>();

  issues.forEach((issue) => {
    const group = groups.get(issue.projectName);

    if (group) {
      group.issues.push(issue);
    } else {
      groups.set(issue.projectName, { projectName: issue.projectName, issues: [issue] });
    }
  });

  return [...groups.values()];
}
