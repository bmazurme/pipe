import type { ResType } from '@reports/shared';
import { extractMarkdownImageRefs } from '@pipe/protocol';

import { describeFetchError } from '../utils/describe-fetch-error';
import { getSettings } from '../settings/props';

const GITLAB_TIMEOUT_MS = 30_000;

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
    signal: AbortSignal.timeout(GITLAB_TIMEOUT_MS),
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

export interface IssueImage {
  relPath: string;
  base64: string;
}

// GitLab stores uploaded issue images under /uploads/<hash>/<filename>,
// relative to the instance root, not the API base (gitlabUrl is
// ".../api/v4"). Fetches only relative refs or ones that already point back
// at this same instance — an image link to some third-party host in the
// description is left alone rather than fetched.
const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;

export async function getIssueImages(description: string): Promise<IssueImage[]> {
  const { gitlabUrl, privateToken } = getSettings();
  if (!gitlabUrl || !privateToken) {
    return [];
  }

  const instanceRoot = gitlabUrl.replace(/\/api\/v4\/?$/, '');
  const refs = extractMarkdownImageRefs(description);

  const images: IssueImage[] = [];
  const usedNames = new Set<string>();
  let totalBytes = 0;

  for (const ref of refs) {
    let absoluteUrl: string;
    if (ref.url.startsWith('/')) {
      absoluteUrl = `${instanceRoot}${ref.url}`;
    } else if (ref.url.startsWith(instanceRoot)) {
      absoluteUrl = ref.url;
    } else {
      continue;
    }

    let response;
    try {
      response = await gitlabFetch(absoluteUrl, privateToken);
    } catch (error) {
      console.warn(`Не удалось скачать изображение из описания issue (${absoluteUrl}):`, error);
      continue;
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
      console.warn(`Изображения issue превысили лимит ${MAX_TOTAL_IMAGE_BYTES} байт — остальные пропущены.`);
      break;
    }

    let name = ref.url.split('/').pop() || 'image';
    while (usedNames.has(name)) {
      name = `${usedNames.size}-${name}`;
    }
    usedNames.add(name);

    images.push({ relPath: `issue-images/${name}`, base64: bytes.toString('base64') });
  }

  return images;
}
