import type { ResType } from '@reports/shared';

import { describeFetchError } from '../utils/describe-fetch-error';
import { getSettings } from '../settings/props';

function authHeaders(privateToken: string) {
  return {
    'Private-Token': privateToken,
    'Content-Type': 'application/json',
  };
}

async function gitlabFetch(url: string, privateToken: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { ...authHeaders(privateToken), ...(init.headers ?? {}) },
  }).catch((error) => {
    throw describeFetchError(error, url);
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');

    throw new Error(`GitLab API вернул ошибку ${response.status}${body ? `: ${body}` : ''}`);
  }

  return response;
}

export async function listAssignedOpenIssues(): Promise<ResType[]> {
  const { gitlabUrl, privateToken, userId } = getSettings();

  if (!gitlabUrl || !privateToken) {
    return [];
  }

  const url = `${gitlabUrl}/issues?assignee_id=${userId}&scope=all&state=opened`;
  const response = await gitlabFetch(url, privateToken);

  return response.json() as Promise<ResType[]>;
}

let cachedUsername: string | undefined;

export async function getCurrentUsername(): Promise<string> {
  if (cachedUsername) {
    return cachedUsername;
  }

  const { gitlabUrl, privateToken } = getSettings();

  if (!gitlabUrl || !privateToken) {
    throw new Error('Интеграция с GitLab не настроена: укажите адрес и токен на странице Settings');
  }

  const response = await gitlabFetch(`${gitlabUrl}/user`, privateToken);
  const user = await response.json() as { username: string };

  cachedUsername = user.username;

  return cachedUsername;
}

export async function addIssueNote(projectId: number | string, iid: number | string, body: string): Promise<void> {
  const { gitlabUrl, privateToken } = getSettings();
  const url = `${gitlabUrl}/projects/${projectId}/issues/${iid}/notes`;

  await gitlabFetch(url, privateToken, { method: 'POST', body: JSON.stringify({ body }) });
}

export async function getIssue(projectId: number | string, iid: number | string): Promise<ResType> {
  const { gitlabUrl, privateToken } = getSettings();
  const url = `${gitlabUrl}/projects/${projectId}/issues/${iid}`;
  const response = await gitlabFetch(url, privateToken);

  return response.json() as Promise<ResType>;
}

export async function getIssueTimeStats(projectId: number | string, iid: number | string): Promise<{ humanTimeEstimate: string | null }> {
  const issue = await getIssue(projectId, iid);

  return { humanTimeEstimate: issue.time_stats?.human_time_estimate ?? null };
}

export async function setIssueTimeEstimate(projectId: number | string, iid: number | string, duration: string): Promise<void> {
  const { gitlabUrl, privateToken } = getSettings();
  const url = `${gitlabUrl}/projects/${projectId}/issues/${iid}/time_estimate?duration=${encodeURIComponent(duration)}`;

  await gitlabFetch(url, privateToken, { method: 'POST' });
}
