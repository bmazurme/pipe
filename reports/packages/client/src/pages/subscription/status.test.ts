import { describe, expect, it } from 'vitest';
import type { SubscriptionIssueType } from '@reports/shared';

import { countByGroup, filterIssues, groupByProject, matchesQuery, statusGroup } from './status';

const make = (iid: string, title: string, step?: 'init' | 'pushed' | 'pulled' | 'published'): SubscriptionIssueType => ({
  id: iid,
  iid,
  projectId: 1,
  projectName: 'bmazurme/pipe',
  title,
  description: '',
  webUrl: '',
  timeEstimate: '',
  state: 'opened',
  status: '',
  tracked: true,
  ...(step ? { subscription: { step } as SubscriptionIssueType['subscription'] } : {}),
});

const issues = [make('1', 'Fix leak scan'), make('2', 'Add timeout', 'pushed'), make('3', 'Docs', 'published')];

describe('subscription status helpers', () => {
  it('groups by pipeline progress', () => {
    expect(issues.map(statusGroup)).toEqual(['new', 'active', 'done']);
  });

  it('counts per group, with all as the total', () => {
    expect(countByGroup(issues)).toEqual({ all: 3, new: 1, active: 1, done: 1 });
  });

  it('matches the query against number, title and project, ignoring case', () => {
    expect(matchesQuery(issues[0], 'LEAK')).toBe(true);
    expect(matchesQuery(issues[0], '1')).toBe(true);
    expect(matchesQuery(issues[0], 'pipe')).toBe(true);
    expect(matchesQuery(issues[0], 'timeout')).toBe(false);
    expect(matchesQuery(issues[0], '   ')).toBe(true);
  });

  it('combines the status filter and the query', () => {
    expect(filterIssues(issues, 'all', '')).toHaveLength(3);
    expect(filterIssues(issues, 'active', '').map((i) => i.iid)).toEqual(['2']);
    expect(filterIssues(issues, 'active', 'docs')).toEqual([]);
  });

  it('groups by repository, preserving first-seen order of repositories and issues', () => {
    const other = { ...make('9', 'Other repo task'), projectName: 'acme/api' };
    const groups = groupByProject([issues[0], other, issues[1]]);

    expect(groups.map((g) => g.projectName)).toEqual(['bmazurme/pipe', 'acme/api']);
    expect(groups[0].issues.map((i) => i.iid)).toEqual(['1', '2']);
    expect(groupByProject([])).toEqual([]);
  });
});
