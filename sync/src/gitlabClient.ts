import { extractMarkdownImageRefs } from '@pipe/protocol';
import { log } from './log.js';

// No request here had an AbortSignal before — a hung GitLab connection (or a
// slow image host for getIssueImages below) would block push-issue/
// gitlab-worker indefinitely.
const GITLAB_TIMEOUT_MS = 30_000;

export interface GitlabIssue {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description: string | null;
}

// apiUrl is expected to already include the API prefix, e.g.
// "https://gitlab.example.com/api/v4" (mirrors reports' subscription/gitlab-client.ts).
export async function getIssue(
  apiUrl: string,
  privateToken: string,
  projectId: string | number,
  iid: string | number,
): Promise<GitlabIssue> {
  const url = `${apiUrl}/projects/${encodeURIComponent(String(projectId))}/issues/${encodeURIComponent(String(iid))}`;
  const response = await fetch(url, {
    headers: { 'Private-Token': privateToken },
    signal: AbortSignal.timeout(GITLAB_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`GitLab API returned ${response.status} for ${url}${body ? `: ${body}` : ''}`);
  }

  return (await response.json()) as GitlabIssue;
}

// scope=assigned_to_me needs no user id — GitLab resolves "me" from the
// token itself. Mirrors reports' subscription/gitlab-client.ts
// listAssignedOpenIssues, minus its assignee_id (reports stores a userId in
// Settings for that; sync has no equivalent, and doesn't need one).
export async function listAssignedOpenIssues(apiUrl: string, privateToken: string): Promise<GitlabIssue[]> {
  const url = `${apiUrl}/issues?scope=assigned_to_me&state=opened`;
  const response = await fetch(url, {
    headers: { 'Private-Token': privateToken },
    signal: AbortSignal.timeout(GITLAB_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`GitLab API returned ${response.status} for ${url}${body ? `: ${body}` : ''}`);
  }

  return (await response.json()) as GitlabIssue[];
}

export interface IssueImage {
  relPath: string;
  base64: string;
}

// Mirrors reports' subscription/gitlab-client.ts getIssueImages — GitLab
// stores uploaded issue images under /uploads/<hash>/<filename> relative to
// the instance root, not the API base (apiUrl is ".../api/v4"). Only
// relative refs or ones already on this same instance are fetched; a link
// to some third-party host in the description is left alone.
const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;

export async function getIssueImages(
  apiUrl: string,
  privateToken: string,
  description: string,
): Promise<IssueImage[]> {
  const instanceRoot = apiUrl.replace(/\/api\/v4\/?$/, '');
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

    let response: Response;
    try {
      response = await fetch(absoluteUrl, {
        headers: { 'Private-Token': privateToken },
        signal: AbortSignal.timeout(GITLAB_TIMEOUT_MS),
      });
    } catch (error) {
      log.warn(`Could not download an image from the issue description (${absoluteUrl}):`, error);
      continue;
    }

    if (!response.ok) {
      log.warn(`Could not download an image from the issue description (${absoluteUrl}): HTTP ${response.status}`);
      continue;
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
      log.warn(`Issue images exceeded the ${MAX_TOTAL_IMAGE_BYTES}-byte limit — the rest were skipped.`);
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
