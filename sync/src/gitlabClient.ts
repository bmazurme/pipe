import {
  getIssue,
  getIssueImages as sharedGetIssueImages,
  listAssignedOpenIssues,
  MAX_TOTAL_IMAGE_BYTES,
  type GitlabIssue,
  type IssueImage,
} from '@pipe/protocol';
import { log } from './log.js';

// getIssue/listAssignedOpenIssues/gitlabFetch/GitlabIssue are re-exported
// as-is (IMPROVEMENTS_TECH.md 2.1) — their signatures already matched the
// shared module exactly (explicit apiUrl/token params, no config of sync's
// own to thread through), so there's nothing sync-specific left to wrap
// around them. getIssueImages is shared too; the only sync-specific part
// left is wording its warnings for sync's own log.
export { getIssue, listAssignedOpenIssues, type GitlabIssue, type IssueImage };

export function getIssueImages(apiUrl: string, privateToken: string, description: string): Promise<IssueImage[]> {
  return sharedGetIssueImages(apiUrl, privateToken, description, {
    onWarn: (warning) => {
      if (warning.kind === 'limit') {
        log.warn(`Issue images exceeded the ${MAX_TOTAL_IMAGE_BYTES}-byte limit — the rest were skipped.`);
      } else if (warning.kind === 'http') {
        log.warn(`Could not download an image from the issue description (${warning.url}): HTTP ${warning.status}`);
      } else {
        log.warn(`Could not download an image from the issue description (${warning.url}):`, warning.error);
      }
    },
  });
}
