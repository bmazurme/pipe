import AdmZip from 'adm-zip';

import type { BaseManifest } from './manifest.js';
import { extractArchive, type PackedAsset, type PackedFile } from './pack.js';

// The manifest name used inside a parcel addressed by GitLab issue (reports'
// Subscription module, sync-cli's push-issue/pull-issue/agent-runner) rather
// than by project name.
export const SUBSCRIPTION_MANIFEST_ENTRY = '__subscription_manifest__.json';

// sync-cli's project-mode manifest name — only needed here to recognize a
// project-mode parcel pulled through the issue path (see
// extractSubscriptionArchive below).
export const SYNC_MANIFEST_ENTRY = '__sync_manifest__.json';

export interface SubscriptionManifest extends BaseManifest {
  issueId: string;
  issueIid: string;
  issueTitle: string;
  issueDescription: string;
  projectId: number;
  branch: string;
  createdAt: string;
}

// Recognizes either manifest name actually present in the archive: the
// subscription-mode one, or — defensively — the older project-mode one, in
// case a project-mode parcel ends up being pulled through the issue path by
// mistake. Both go through extractArchive, so the schemaVersion and
// contentHash checks apply either way. The legacy manifest carries no issue
// metadata, so those fields come back empty and `legacyManifest` is set so
// callers can warn instead of silently printing blanks as if they were real
// title/description/branch.
export function extractSubscriptionArchive(buffer: Buffer): {
  manifest: SubscriptionManifest;
  files: PackedFile[];
  assets: PackedAsset[];
  legacyManifest: boolean;
} {
  const zip = new AdmZip(buffer);

  if (zip.getEntry(SUBSCRIPTION_MANIFEST_ENTRY)) {
    const { manifest, files, assets } = extractArchive<SubscriptionManifest>(buffer, SUBSCRIPTION_MANIFEST_ENTRY);
    return { manifest, files, assets, legacyManifest: false };
  }

  if (!zip.getEntry(SYNC_MANIFEST_ENTRY)) {
    throw new Error(
      `Archive is missing both ${SUBSCRIPTION_MANIFEST_ENTRY} and ${SYNC_MANIFEST_ENTRY} — not a sync-cli/reports parcel.`,
    );
  }

  const { manifest: legacy, files, assets } = extractArchive<BaseManifest & { createdAt: string }>(
    buffer,
    SYNC_MANIFEST_ENTRY,
  );

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
