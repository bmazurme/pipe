import AdmZip from 'adm-zip';
import {
  buildArchive,
  extractArchive,
  type BaseManifest,
  type PackedAsset,
  type PackedFile,
} from '@pipe/protocol';

// The two manifest shapes a parcel already sitting in bridge storage can
// have — reports' Subscription module and sync's own push-issue write
// __subscription_manifest__.json; sync's whole-project push writes
// __sync_manifest__.json. Worker doesn't know in advance which one a given
// job's parcel is, so it probes for whichever is actually present, the same
// technique sync's issuePack.ts already uses for the same reason.
export const SUBSCRIPTION_MANIFEST_ENTRY = '__subscription_manifest__.json';
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

export interface ExtractedParcel {
  manifestEntry: string;
  manifest: BaseManifest & Record<string, unknown>;
  files: PackedFile[];
  assets: PackedAsset[];
}

export function extractParcel(buffer: Buffer): ExtractedParcel {
  const zip = new AdmZip(buffer);
  const entryNames = new Set(zip.getEntries().map((entry) => entry.entryName));

  const manifestEntry = entryNames.has(SUBSCRIPTION_MANIFEST_ENTRY)
    ? SUBSCRIPTION_MANIFEST_ENTRY
    : entryNames.has(SYNC_MANIFEST_ENTRY)
      ? SYNC_MANIFEST_ENTRY
      : undefined;

  if (!manifestEntry) {
    throw new Error(
      `Parcel has no recognized manifest (expected ${SUBSCRIPTION_MANIFEST_ENTRY} or ${SYNC_MANIFEST_ENTRY})`,
    );
  }

  const { manifest, files, assets } = extractArchive<BaseManifest & Record<string, unknown>>(
    buffer,
    manifestEntry,
  );

  return { manifestEntry, manifest, files, assets };
}

// Re-packs a (possibly edited) file set into a new archive using the exact
// manifest shape/entry name the parcel was extracted with, so the result
// round-trips through whichever side (reports' Subscription, or sync's
// pull-issue/pull) eventually consumes it, unchanged from its perspective.
export function buildResultParcel(parcel: ExtractedParcel, files: PackedFile[]): Buffer {
  const { schemaVersion: _schemaVersion, contentHash: _contentHash, ...manifestFields } = parcel.manifest;

  const { buffer } = buildArchive(parcel.manifestEntry, files, manifestFields, parcel.assets);
  return buffer;
}

// Worker never de-anonymizes anything (same rule as agent-runner) — this
// only reads whatever placeholder-substituted title/description the parcel
// already carries, to give the model something to work from. A project-mode
// (__sync_manifest__.json) parcel has no issue text at all.
export function describeTask(parcel: ExtractedParcel): string {
  if (parcel.manifestEntry === SUBSCRIPTION_MANIFEST_ENTRY) {
    const manifest = parcel.manifest as unknown as SubscriptionManifest;
    return `Task (GitLab issue): ${manifest.issueTitle}\n\n${manifest.issueDescription}`;
  }

  return 'No task description was included with this parcel — review the code and make general improvements.';
}
