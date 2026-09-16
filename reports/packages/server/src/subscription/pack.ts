import {
  buildArchive as buildArchiveGeneric,
  extractArchive as extractArchiveGeneric,
  contentHash,
  type BaseManifest,
  type PackedFile,
} from '@pipe/protocol';

export const MANIFEST_ENTRY = '__subscription_manifest__.json';

export type { PackedFile };
export { contentHash };

export interface SubscriptionManifest extends BaseManifest {
  issueId: string;
  issueIid: string;
  issueTitle: string;
  issueDescription: string;
  projectId: number;
  branch: string;
  createdAt: string;
}

export function buildArchive(
  files: PackedFile[],
  manifest: Omit<SubscriptionManifest, 'contentHash' | 'schemaVersion'>,
): Buffer {
  const { buffer } = buildArchiveGeneric<SubscriptionManifest>(MANIFEST_ENTRY, files, manifest);
  return buffer;
}

export function extractArchive(buffer: Buffer): { manifest: SubscriptionManifest; files: PackedFile[] } {
  return extractArchiveGeneric<SubscriptionManifest>(buffer, MANIFEST_ENTRY);
}
