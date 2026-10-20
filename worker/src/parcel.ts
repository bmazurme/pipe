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
  // The issue's comments, oldest first (anonymized like the description); absent when it had none or the parcel is older.
  issueComments?: { author: string; createdAt: string; body: string }[];
  // A migration task: the current repository is under sourceRoot, the one the project moves to under targetRoot (see reports' Subscription).
  migration?: { name?: string; sourceRoot: string; targetRoot: string };
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
export function buildResultParcel(
  parcel: ExtractedParcel,
  files: PackedFile[],
  assets: PackedAsset[] = parcel.assets,
): Buffer {
  const { schemaVersion: _schemaVersion, contentHash: _contentHash, ...manifestFields } = parcel.manifest;

  const { buffer } = buildArchive(parcel.manifestEntry, files, manifestFields, assets);
  return buffer;
}

// Worker never de-anonymizes anything (same rule as agent-runner) — this
// only reads whatever placeholder-substituted title/description the parcel
// already carries, to give the model something to work from. A project-mode
// (__sync_manifest__.json) parcel has no issue text at all.
export function describeTask(parcel: ExtractedParcel): string {
  if (parcel.manifestEntry === SUBSCRIPTION_MANIFEST_ENTRY) {
    const manifest = parcel.manifest as unknown as SubscriptionManifest;

    if (manifest.migration) return describeMigration(manifest, parcel);
    const comments = (manifest.issueComments ?? [])
      .map((comment) => `--- ${[comment.author, comment.createdAt].filter(Boolean).join(', ')}:\n${comment.body}`)
      .join('\n\n');
    const hasImages = parcel.assets.some((asset) => asset.relPath.startsWith('issue-images/'));

    return [
      `Task (GitLab issue): ${manifest.issueTitle}\n\n${manifest.issueDescription}`,
      comments ? `Comments on the issue, oldest first (they may clarify or change the task):\n\n${comments}` : '',
      hasImages ? 'Images attached to the description and the comments are in the issue-images/ folder.' : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  return 'No task description was included with this parcel — review the code and make general improvements.';
}

// A migration task: the model gets the current repository to read and the target one to work in, and the person's text saying which
// module to bring up to date or add there. Only target/ comes back to the person's machine — source/ changes are thrown away.
function describeMigration(manifest: SubscriptionManifest, parcel: ExtractedParcel): string {
  const { sourceRoot, targetRoot, name } = manifest.migration!;
  const hasImages = parcel.assets.some((asset) => asset.relPath.startsWith('issue-images/'));

  return [
    `Migration task${name ? ` (${name})` : ''}: ${manifest.issueTitle}`,
    [
      'The project is moving from one repository to another, usually onto a different stack.',
      `- \`${sourceRoot}\` is the CURRENT repository (the old stack). It is a read-only reference: anything changed there is thrown away.`,
      `- \`${targetRoot}\` is the repository the project is moving TO (the new stack). It may already hold part of the project. Your work goes here.`,
    ].join('\n'),
    `What has to be done in ${targetRoot} — the text says which module to bring up to date or to add:\n\n${manifest.issueDescription}`,
    [
      'How to work:',
      `- Read the relevant code in ${sourceRoot} to see what the module does, then implement it in ${targetRoot} in the target's own stack, structure, conventions and naming — do not translate source code line by line.`,
      `- If the module already exists in ${targetRoot}, bring it up to date with ${sourceRoot} instead of adding a second copy, and keep what is still right.`,
      `- Change only files under ${targetRoot}. Put new files where the target's own structure expects them, and add or update tests there if the target has them.`,
      '- Names, hosts and identifiers that look like placeholders are placeholders: keep them exactly as they are.',
      `- When you finish, say briefly what was added or changed in ${targetRoot}, and anything in ${sourceRoot} that could not be ported, and why.`,
    ].join('\n'),
    hasImages ? 'Images attached to the task are in the issue-images/ folder.' : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}
