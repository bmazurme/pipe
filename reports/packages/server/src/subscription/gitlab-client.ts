import type { ResType } from '@reports/shared';
import {
  extractMarkdownImageRefs,
  GitlabApiError,
  gitlabFetch as sharedGitlabFetch,
  getIssue as sharedGetIssue,
  listAssignedOpenIssues as sharedListAssignedOpenIssues,
} from '@pipe/protocol';

import { describeFetchError } from '../utils/describe-fetch-error';
import { getSettings } from '../settings/props';

// Translates the shared module's errors into reports' own localized shape —
// a GitlabApiError (bad HTTP status) becomes a Russian message built from
// its status/body, anything else (a network failure) goes through
// describeFetchError the same as every other reports HTTP client.
function translateGitlabError(error: unknown, url: string): Error {
  if (error instanceof GitlabApiError) {
    return new Error(`GitLab API вернул ошибку ${error.status}${error.body ? `: ${error.body}` : ''}`);
  }
  return describeFetchError(error, url);
}

// Built on the shared GitLab fetch helper (IMPROVEMENTS_TECH.md 2.1) — this
// wrapper exists because reports reads apiUrl/token from a global Settings
// singleton instead of taking them as explicit params (sync's shape), and
// localizes its error messages into Russian for the Subscription UI's
// stream, neither of which the shared module does on its own.
async function gitlabFetch(url: string, privateToken: string, init: RequestInit = {}): Promise<Response> {
  return sharedGitlabFetch(url, privateToken, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  }).catch((error) => {
    throw translateGitlabError(error, url);
  });
}

export async function listAssignedOpenIssues(): Promise<ResType[]> {
  const { gitlabUrl, privateToken, userId } = getSettings();

  if (!gitlabUrl || !privateToken) {
    return [];
  }

  const issues = await sharedListAssignedOpenIssues(gitlabUrl, privateToken, { assigneeId: userId }).catch((error) => {
    throw translateGitlabError(error, gitlabUrl);
  });

  return issues as unknown as ResType[];
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

  const issue = await sharedGetIssue(gitlabUrl, privateToken, projectId, iid).catch((error) => {
    throw translateGitlabError(error, gitlabUrl);
  });

  return issue as unknown as ResType;
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
