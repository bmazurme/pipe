import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  buildArchive as buildArchiveGeneric,
  extractSubscriptionArchive,
  SUBSCRIPTION_MANIFEST_ENTRY,
  type SubscriptionManifest,
  type PackedFile,
  type PackedAsset,
} from '@pipe/protocol';

import { type Dictionary, toLocal } from './dictionary.js';

// The issue-parcel format (manifest name, manifest shape, extraction with a
// legacy project-mode fallback) lives in @pipe/protocol, shared with reports'
// subscription/pack.ts.
export { SUBSCRIPTION_MANIFEST_ENTRY, type SubscriptionManifest };
export const extractIssueArchive = extractSubscriptionArchive;

export function buildIssueArchive(
  files: PackedFile[],
  manifest: Omit<SubscriptionManifest, 'contentHash' | 'schemaVersion'>,
  assets: PackedAsset[] = [],
): Buffer {
  const { buffer } = buildArchiveGeneric<SubscriptionManifest>(SUBSCRIPTION_MANIFEST_ENTRY, files, manifest, assets);
  return buffer;
}

export const ISSUE_FILE_NAME = 'ISSUE.md';

function buildIssueFileBody(
  manifest: SubscriptionManifest,
  title: string,
  description: string,
  imagePaths: string[],
  parcelId: number,
): string {
  return [
    `# Issue #${manifest.issueIid} (project ${manifest.projectId})`,
    '',
    title,
    '',
    description,
    '',
    ...(imagePaths.length > 0 ? ['## Images', '', ...imagePaths.map((p) => `- ${p}`), ''] : []),
    '---',
    `Branch: ${manifest.branch}`,
    `Pulled: ${new Date().toISOString()} (parcel id ${parcelId})`,
    '',
  ].join('\n');
}

// De-anonymizes the manifest's title/description and writes them to a plain
// file inside the pulled project — pull-issue used to only print these to
// the console, which is easy to lose (scrollback, a non-interactive runner)
// and unusable by whatever picks up the branch next (a human, or an agent
// per ROADMAP.md's task->agent->review pipeline, which needs the task
// text sitting next to the code, not in a terminal that already closed).
//
// Assets (images pulled from the issue description) are written to disk
// too, listed by their local path rather than rewritten in place inline:
// two differently-named-upstream images can collide to the same local
// filename and get de-duplicated (see gitlabClient.ts getIssueImages), so
// reconstructing "which inline ![]() referred to which written file" after
// the fact isn't reliably unambiguous — an explicit list is.
export function extractIssue(
  projectPath: string,
  manifest: SubscriptionManifest,
  dictionary: Dictionary,
  parcelId: number,
  assets: PackedAsset[] = [],
): { path: string; title: string; description: string; imagePaths: string[] } {
  const title = toLocal(dictionary, manifest.issueTitle);
  const description = toLocal(dictionary, manifest.issueDescription);

  const imagePaths = assets.map((asset) => asset.relPath);
  for (const asset of assets) {
    const destination = path.join(projectPath, asset.relPath);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, Buffer.from(asset.base64, 'base64'));
  }

  const destination = path.join(projectPath, ISSUE_FILE_NAME);
  writeFileSync(destination, buildIssueFileBody(manifest, title, description, imagePaths, parcelId), 'utf-8');

  return { path: destination, title, description, imagePaths };
}

// Re-writes ISSUE.md after a `--review` edit — keeps the same branch/pulled
// footer and image list extractIssue already wrote, just with the (possibly
// edited) title/description, so the file on disk matches what was actually
// dispatched to the agent.
export function updateIssueFile(
  destination: string,
  manifest: SubscriptionManifest,
  title: string,
  description: string,
  imagePaths: string[],
  parcelId: number,
): void {
  writeFileSync(destination, buildIssueFileBody(manifest, title, description, imagePaths, parcelId), 'utf-8');
}
