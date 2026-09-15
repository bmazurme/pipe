import { writeFileSync } from 'node:fs';
import path from 'node:path';

import AdmZip from 'adm-zip';

import { type Dictionary, toLocal } from './dictionary.js';
import { contentHash, MANIFEST_ENTRY as LEGACY_MANIFEST_ENTRY, type PackedFile } from './pack.js';

// Matches reports' subscription/pack.ts (MANIFEST_ENTRY) — the manifest name
// used inside a parcel addressed by GitLab issue rather than by project name.
export const SUBSCRIPTION_MANIFEST_ENTRY = '__subscription_manifest__.json';

export interface SubscriptionManifest {
  issueId: string;
  issueIid: string;
  issueTitle: string;
  issueDescription: string;
  projectId: number;
  branch: string;
  createdAt: string;
  contentHash: string;
}

export function buildIssueArchive(
  files: PackedFile[],
  manifest: Omit<SubscriptionManifest, 'contentHash'>,
): Buffer {
  const fullManifest: SubscriptionManifest = { ...manifest, contentHash: contentHash(files) };
  const zip = new AdmZip();

  for (const file of files) {
    zip.addFile(file.relPath, Buffer.from(file.content, 'utf-8'));
  }
  zip.addFile(SUBSCRIPTION_MANIFEST_ENTRY, Buffer.from(JSON.stringify(fullManifest, null, 2), 'utf-8'));

  return zip.toBuffer();
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

  const files = entries
    .filter((entry) => entry.entryName !== SUBSCRIPTION_MANIFEST_ENTRY && entry.entryName !== LEGACY_MANIFEST_ENTRY)
    .map((entry) => ({ relPath: entry.entryName, content: entry.getData().toString('utf-8') }));

  if (subscriptionEntry) {
    return {
      manifest: JSON.parse(subscriptionEntry.getData().toString('utf-8')) as SubscriptionManifest,
      files,
      legacyManifest: false,
    };
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
    },
    files,
    legacyManifest: true,
  };
}

export const ISSUE_FILE_NAME = 'ISSUE.md';

// De-anonymizes the manifest's title/description and writes them to a plain
// file inside the pulled project — pull-issue used to only print these to
// the console, which is easy to lose (scrollback, a non-interactive runner)
// and unusable by whatever picks up the branch next (a human, or an agent
// per docs/roadmap.md's task->agent->review pipeline, which needs the task
// text sitting next to the code, not in a terminal that already closed).
export function extractIssue(
  projectPath: string,
  manifest: SubscriptionManifest,
  dictionary: Dictionary,
  parcelId: number,
): { path: string; title: string; description: string } {
  const title = toLocal(dictionary, manifest.issueTitle);
  const description = toLocal(dictionary, manifest.issueDescription);

  const body = [
    `# Issue #${manifest.issueIid} (project ${manifest.projectId})`,
    '',
    title,
    '',
    description,
    '',
    '---',
    `Branch: ${manifest.branch}`,
    `Pulled: ${new Date().toISOString()} (parcel id ${parcelId})`,
    '',
  ].join('\n');

  const destination = path.join(projectPath, ISSUE_FILE_NAME);
  writeFileSync(destination, body, 'utf-8');

  return { path: destination, title, description };
}
