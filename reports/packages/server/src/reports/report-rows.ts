import type { IssueResponse } from '@reports/shared';

import { convertToHours } from './convert-to-hours';
import { statusDict } from './constants';

export type ReportRow = { name: string; status: string; time: number };

export function toReportRows(issues: IssueResponse[number][], projectDict: Record<string, string>): ReportRow[] {
  return issues.map((issue) => {
    const title = issue.title.trim();
    const normalizedTitle = title.endsWith('.') ? title : `${title}.`;

    return {
      name: `${issue.iid} ${projectDict[issue.project_id] || ''} ${normalizedTitle}`,
      status: statusDict[issue.state],
      time: convertToHours(issue.time_stats?.human_time_estimate || '0'),
    };
  });
}
