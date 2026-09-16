import type { Request, Response } from 'express';
import type { BridgeReportEntry, IssueResponse, ResultType, StreamEvent } from '@reports/shared';
// import path from 'path';
// import { fileURLToPath } from 'url';
// import { dirname } from 'path';

import { exportToCsv } from './export-to-csv';
import { getCurrentMonthDates } from './get-current-month-dates';
import { convertToHours } from './convert-to-hours';
import { statusDict } from './constants';
import { buildName } from './build-name';
import { mockReports } from './mock-data';
import { pushReportToBridge } from './push-to-bridge';
import { getSettings } from '../settings/props';
import { getProjectDict } from './project-dict-props';

export async function handleReport(req: Request, res: Response) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  const sendEvent = (event: StreamEvent) => {
    res.write(JSON.stringify(event) + '\n');
  };
  let issues: any = [];

  const { gitlabUrl: GITLAB_URL, privateToken: PRIVATE_TOKEN, userId: USER_ID } = getSettings();
  const projectDict = getProjectDict();

  if (!GITLAB_URL) {
    sendEvent({ type: 'message', data: mockReports });
    res.end();
    return;
  }

  const filename = buildName();
  const { start, end } = getCurrentMonthDates();
  const fetchConfig = {
    method: 'GET',
    headers: {
      'Private-Token': PRIVATE_TOKEN,
      'Content-Type': 'application/json'
    },
  };
  const closedUrl = `${GITLAB_URL}/issues?assignee_id=${USER_ID}&scope=all&state=closed&updated_after=${start}`;
  const openUrl = `${GITLAB_URL}/issues?assignee_id=${USER_ID}&scope=all&state=opened`;

  try {
    const [closedResponse, openResponse] = await Promise.all([
      fetch(closedUrl, fetchConfig),
      fetch(openUrl, fetchConfig),
    ]);

    if (!closedResponse.ok) {
      throw new Error(`Ошибка HTTP для закрытых задач: ${closedResponse.status}`);
    }

    if (!openResponse.ok) {
      throw new Error(`Ошибка HTTP для открытых задач: ${openResponse.status}`);
    }

    const [closedIssues, openedIssues] = await Promise.all([
      closedResponse.json() as Promise<IssueResponse>,
      openResponse.json()  as Promise<IssueResponse>,
    ]);
    const allIssues = [...closedIssues, ...openedIssues];
    const result: ResultType[] = [];

    allIssues.forEach(async (issue) => {
      result.push({
        id: issue.id,
        iid: issue.iid,
        title: issue.title,
        project: issue.project_id,
        status: issue.state,
        created: issue.created_at,
        timeStats: issue.time_stats?.human_time_estimate || '0',
      });
    });
    
    issues = result.map((x) => {
      const title = x.title.trim();
      const normalizedTitle = title.endsWith('.') ? title : `${title}.`;

      return {
        name: `${x.iid} ${projectDict[x.project] || ''} ${normalizedTitle}`,
        status: statusDict[x.status],
        time: convertToHours(x.timeStats),
      };
    });

    exportToCsv(filename, issues);
  } catch (error) {
    console.error('Ошибка при получении задач:', error);
  }

  try {
    // const __dirname = dirname(fileURLToPath(import.meta.url));
    // const filePath = path.join(__dirname, '..', '..', filename)

    // res.setHeader('Content-Type', 'text/csv');
    // res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // res.sendFile(filePath);

    sendEvent({ type: 'message', data: issues });
    res.end();
  } catch (error) {
    console.error('Counts error:', error);
    sendEvent({
      type: 'error',
      data: error instanceof Error ? error.message : 'Unknown error',
    });
    res.end();
  }
}

export async function handlePushReport(req: Request, res: Response) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  const sendEvent = (event: StreamEvent) => {
    res.write(JSON.stringify(event) + '\n');
  };

  try {
    const { year, month, entries } = req.body as { year: number; month: number; entries: BridgeReportEntry[] };

    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error('Нет данных для отправки: в отчёте нет задач с затраченным временем');
    }

    const result = await pushReportToBridge(year, month, entries);

    sendEvent({ type: 'message', data: result });
    res.end();
  } catch (error) {
    console.error('Push report to bridge error:', error);
    sendEvent({
      type: 'error',
      data: error instanceof Error ? error.message : 'Unknown error',
    });
    res.end();
  }
}
