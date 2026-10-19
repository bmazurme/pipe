import type { ResType } from '@reports/shared';
import {
  GitlabApiError,
  gitlabFetch as sharedGitlabFetch,
  getIssue as sharedGetIssue,
  getIssueImages as sharedGetIssueImages,
  MAX_TOTAL_IMAGE_BYTES,
  type GitlabNote,
  type IssueImage,
  listAssignedOpenIssues as sharedListAssignedOpenIssues,
  listIssueNotes as sharedListIssueNotes,
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
  const url = `${gitlabUrl}/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(iid)}/notes`;

  await gitlabFetch(url, privateToken, { method: 'POST', body: JSON.stringify({ body }) });
}

export async function getIssue(projectId: number | string, iid: number | string): Promise<ResType> {
  const { gitlabUrl, privateToken } = getSettings();

  const issue = await sharedGetIssue(gitlabUrl, privateToken, projectId, iid).catch((error) => {
    throw translateGitlabError(error, gitlabUrl);
  });

  return issue as unknown as ResType;
}

export type { GitlabNote };

// The issue's comments (system notes left out), oldest first — they travel in the parcel next to the description.
export async function getIssueNotes(projectId: number | string, iid: number | string): Promise<GitlabNote[]> {
  const { gitlabUrl, privateToken } = getSettings();

  return sharedListIssueNotes(gitlabUrl, privateToken, projectId, iid).catch((error) => {
    throw translateGitlabError(error, gitlabUrl);
  });
}

export async function getIssueTimeStats(projectId: number | string, iid: number | string): Promise<{ humanTimeEstimate: string | null }> {
  const issue = await getIssue(projectId, iid);

  return { humanTimeEstimate: issue.time_stats?.human_time_estimate ?? null };
}

export async function setIssueTimeEstimate(projectId: number | string, iid: number | string, duration: string): Promise<void> {
  const { gitlabUrl, privateToken } = getSettings();
  const url = `${gitlabUrl}/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(iid)}/time_estimate?duration=${encodeURIComponent(duration)}`;

  await gitlabFetch(url, privateToken, { method: 'POST' });
}

export type { IssueImage };

// The download itself is shared with sync (@pipe/protocol's getIssueImages);
// this wrapper only supplies apiUrl/token from Settings and words the
// warnings in Russian, with the failure translated like every other
// GitLab error here.
export async function getIssueImages(description: string, projectId?: string | number): Promise<IssueImage[]> {
  const { gitlabUrl, privateToken } = getSettings();
  if (!gitlabUrl || !privateToken) {
    return [];
  }

  return sharedGetIssueImages(gitlabUrl, privateToken, description, {
    projectId,
    onWarn: (warning) => {
      if (warning.kind === 'limit') {
        console.warn(`Изображения issue превысили лимит ${MAX_TOTAL_IMAGE_BYTES} байт — остальные пропущены.`);
        return;
      }
      const url = warning.url ?? gitlabUrl;
      console.warn(`Не удалось скачать изображение из описания issue (${url}):`, translateGitlabError(warning.error, url));
    },
  });
}
