import type { IssueResponse } from '@reports/shared';

import { convertToHours } from './convert-to-hours';
import { statusDict } from './constants';

export type ReportRow = { name: string; status: string; time: number; created: string };

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

// YYYYMMDDHHMMSS in local time; '' for a missing or unreadable date.
export function formatCreated(createdAt: string | undefined): string {
  const date = new Date(createdAt ?? '');

  if (Number.isNaN(date.getTime())) return '';

  return (
    pad(date.getFullYear(), 4) +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

export function toReportRows(issues: IssueResponse[number][], projectDict: Record<string, string>): ReportRow[] {
  return issues.map((issue) => {
    const title = issue.title.trim();
    const normalizedTitle = title.endsWith('.') ? title : `${title}.`;

    return {
      name: `${issue.iid} ${projectDict[issue.project_id] || ''} ${normalizedTitle}`,
      status: statusDict[issue.state],
      time: convertToHours(issue.time_stats?.human_time_estimate || '0'),
      created: formatCreated(issue.created_at),
    };
  });
}
