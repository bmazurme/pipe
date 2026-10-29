import type { Request, Response } from 'express';
import type { BridgeReportEntry, IssueResponse } from '@reports/shared';

import { toReportRows, type ReportRow } from './report-rows';
import { exportToCsv } from './export-to-csv';
import { getCurrentMonthDates } from './get-current-month-dates';
import { buildName } from './build-name';
import { mockReports } from './mock-data';
import { pushReportToBridge } from './push-to-bridge';
import { getSettings } from '../settings/props';
import { getProjectDict } from './project-dict-props';
import { fetchAllPages } from './fetch-all-pages';
import { streamSender, withStream } from '../utils/stream';

const GITLAB_TIMEOUT_MS = 30_000;

export async function handleReport(req: Request, res: Response) {
  const sendEvent = streamSender(res);
  let issues: ReportRow[] = [];

  const { gitlabUrl: GITLAB_URL, privateToken: PRIVATE_TOKEN, userId: USER_ID } = getSettings();
  const projectDict = getProjectDict();

  if (!GITLAB_URL) {
    sendEvent({ type: 'message', data: mockReports });
    res.end();
    return;
  }

  const filename = buildName();
  const { start } = getCurrentMonthDates();
  const fetchConfig = {
    method: 'GET',
    headers: {
      'Private-Token': PRIVATE_TOKEN,
      'Content-Type': 'application/json'
    },
    signal: AbortSignal.timeout(GITLAB_TIMEOUT_MS),
  };
  const closedUrl = `${GITLAB_URL}/issues?assignee_id=${USER_ID}&scope=all&state=closed&updated_after=${start}`;
  const openUrl = `${GITLAB_URL}/issues?assignee_id=${USER_ID}&scope=all&state=opened`;

  try {
    const [closedIssues, openedIssues] = await Promise.all([
      fetchAllPages<IssueResponse[number]>(closedUrl, fetchConfig, GITLAB_TIMEOUT_MS, 'закрытых задач'),
      fetchAllPages<IssueResponse[number]>(openUrl, fetchConfig, GITLAB_TIMEOUT_MS, 'открытых задач'),
    ]);
    issues = toReportRows([...closedIssues, ...openedIssues], projectDict);
  } catch (error) {
    console.error('Ошибка при получении задач:', error);
    sendEvent({
      type: 'error',
      data: error instanceof Error ? error.message : 'Unknown error',
    });
    res.end();
    return;
  }

  try {
    await exportToCsv(filename, issues);
  } catch (error) {
    console.error('Ошибка при сохранении CSV:', error);
  }

  try {
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
  await withStream(res, 'Push report to bridge', async () => {
    const { year, month, entries } = req.body as { year: number; month: number; entries: BridgeReportEntry[] };

    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error('Нет данных для отправки: в отчёте нет задач с затраченным временем');
    }

    const result = await pushReportToBridge(year, month, entries);

    return result;
  });
}
