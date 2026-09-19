import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import AdmZip from 'adm-zip';

import {
  buildArchive as buildArchiveGeneric,
  assertSchemaVersion,
  ASSET_PREFIX,
  type BaseManifest,
  type PackedFile,
  type PackedAsset,
} from '@pipe/protocol';

import { type Dictionary, toLocal } from './dictionary.js';
import { MANIFEST_ENTRY as LEGACY_MANIFEST_ENTRY } from './pack.js';

// Matches reports' subscription/pack.ts (MANIFEST_ENTRY) — the manifest name
// used inside a parcel addressed by GitLab issue rather than by project name.
export const SUBSCRIPTION_MANIFEST_ENTRY = '__subscription_manifest__.json';

export interface SubscriptionManifest extends BaseManifest {
  issueId: string;
  issueIid: string;
  issueTitle: string;
  issueDescription: string;
  projectId: number;
  branch: string;
  createdAt: string;
}

export function buildIssueArchive(
  files: PackedFile[],
  manifest: Omit<SubscriptionManifest, 'contentHash' | 'schemaVersion'>,
  assets: PackedAsset[] = [],
): Buffer {
  const { buffer } = buildArchiveGeneric<SubscriptionManifest>(SUBSCRIPTION_MANIFEST_ENTRY, files, manifest, assets);
  return buffer;
}

// Recognizes either manifest name actually present in the archive: the
// subscription-mode one (reports, and sync-cli's own push-issue), or —
// defensively — the older project-mode one, in case a project-mode parcel
// ends up being pulled through pull-issue by mistake. The legacy manifest
// carries no issue metadata, so those fields come back empty and
// `legacyManifest` is set so callers can warn instead of silently printing
// blanks as if they were real title/description/branch.
export function extractIssueArchive(buffer: Buffer): {
  manifest: SubscriptionManifest;
  files: PackedFile[];
  assets: PackedAsset[];
  legacyManifest: boolean;
} {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);

  const subscriptionEntry = entries.find((entry) => entry.entryName === SUBSCRIPTION_MANIFEST_ENTRY);
  const legacyEntry = entries.find((entry) => entry.entryName === LEGACY_MANIFEST_ENTRY);

  if (!subscriptionEntry && !legacyEntry) {
    throw new Error(
      `Archive is missing both ${SUBSCRIPTION_MANIFEST_ENTRY} and ${LEGACY_MANIFEST_ENTRY} — not a sync-cli/reports parcel.`,
    );
  }

  const contentEntries = entries.filter(
    (entry) => entry.entryName !== SUBSCRIPTION_MANIFEST_ENTRY && entry.entryName !== LEGACY_MANIFEST_ENTRY,
  );
  const files = contentEntries
    .filter((entry) => !entry.entryName.startsWith(ASSET_PREFIX))
    .map((entry) => ({ relPath: entry.entryName, content: entry.getData().toString('utf-8') }));
  const assets = contentEntries
    .filter((entry) => entry.entryName.startsWith(ASSET_PREFIX))
    .map((entry) => ({ relPath: entry.entryName.slice(ASSET_PREFIX.length), base64: entry.getData().toString('base64') }));

  if (subscriptionEntry) {
    const manifest = JSON.parse(subscriptionEntry.getData().toString('utf-8')) as SubscriptionManifest;
    assertSchemaVersion(manifest, SUBSCRIPTION_MANIFEST_ENTRY);

    return { manifest, files, assets, legacyManifest: false };
  }

  const legacy = JSON.parse(legacyEntry!.getData().toString('utf-8')) as {
    createdAt: string;
    contentHash: string;
  };

  return {
    manifest: {
      issueId: '',
      issueIid: '',
      issueTitle: '',
      issueDescription: '',
      projectId: 0,
      branch: '',
      createdAt: legacy.createdAt,
      contentHash: legacy.contentHash,
      schemaVersion: 0,
    },
    files,
    assets,
    legacyManifest: true,
  };
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
// per docs/roadmap.md's task->agent->review pipeline, which needs the task
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
