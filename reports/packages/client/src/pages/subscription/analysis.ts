import type { AnalysisKindType, SubscriptionIssueType } from '@reports/shared';

// Mirrors the server's ANALYSIS_TITLE_PREFIX (subscription/analysis.ts) —
// @reports/shared holds types only, so there is no shared runtime constant.
export const ANALYSIS_TITLE_PREFIX = 'Analysis ';

export const isAnalysisIssue = (issue: SubscriptionIssueType): boolean => issue.title.startsWith(ANALYSIS_TITLE_PREFIX);

export const KIND_OPTIONS: { value: AnalysisKindType; content: string }[] = [
  { value: 'general', content: 'Общий обзор' },
  { value: 'uiux', content: 'UI/UX' },
  { value: 'security', content: 'Безопасность' },
  { value: 'tests', content: 'Тесты' },
  { value: 'performance', content: 'Производительность' },
  { value: 'docs', content: 'Документация' },
  { value: 'reliability', content: 'Надёжность' },
];

