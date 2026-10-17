import {
  extractMarkdownImageRefs,
  GitlabApiError,
  gitlabFetch,
  getIssue,
  listAssignedOpenIssues,
  resolveIssueUploadUrl,
  type GitlabIssue,
} from '@pipe/protocol';
import { log } from './log.js';

// getIssue/listAssignedOpenIssues/gitlabFetch/GitlabIssue are re-exported
// as-is (IMPROVEMENTS_TECH.md 2.1) — their signatures already matched the
// shared module exactly (explicit apiUrl/token params, no config of sync's
// own to thread through), so there's nothing sync-specific left to wrap
// around them. getIssueImages stays local: its own two distinct warning
// messages (network failure vs. a bad HTTP status) aren't worth forcing
// through a shared callback API for ~50 lines of control flow, so it's
// still implemented here, just built on the shared gitlabFetch instead of
// a raw fetch() call.
export { getIssue, listAssignedOpenIssues, type GitlabIssue };

export interface IssueImage {
  relPath: string;
  base64: string;
}

// GitLab stores uploaded issue images under /uploads/<hash>/<filename>
// relative to the instance root, not the API base (apiUrl is ".../api/v4").
// Only refs to this same instance's /uploads/ are fetched (see
// resolveIssueUploadUrl); a link to any other host is left alone.
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
    const absoluteUrl = resolveIssueUploadUrl(instanceRoot, ref.url);
    if (!absoluteUrl) {
      continue;
    }

    let response: Response;
    try {
      // A redirect is not followed (it would carry Private-Token along) — the
      // 3xx comes back as a non-ok status and the image is skipped below.
      response = await gitlabFetch(absoluteUrl, privateToken, { redirect: 'manual' });
    } catch (error) {
      if (error instanceof GitlabApiError) {
        log.warn(`Could not download an image from the issue description (${absoluteUrl}): HTTP ${error.status}`);
      } else {
        log.warn(`Could not download an image from the issue description (${absoluteUrl}):`, error);
      }
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
