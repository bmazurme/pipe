import type { SubscriptionIssueType } from '@reports/shared';

// Mirrors the server's ANALYSIS_TITLE_PREFIX (subscription/analysis.ts) —
// @reports/shared holds types only, so there is no shared runtime constant.
export const ANALYSIS_TITLE_PREFIX = 'Analysis ';

export const isAnalysisIssue = (issue: SubscriptionIssueType): boolean => issue.title.startsWith(ANALYSIS_TITLE_PREFIX);
