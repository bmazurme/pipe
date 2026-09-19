import {
  buildArchive as buildArchiveGeneric,
  extractArchive as extractArchiveGeneric,
  contentHash,
  type BaseManifest,
  type PackedFile,
  type PackedAsset,
} from '@pipe/protocol';

export const MANIFEST_ENTRY = '__subscription_manifest__.json';

export type { PackedFile, PackedAsset };
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
  assets: PackedAsset[] = [],
): Buffer {
  const { buffer } = buildArchiveGeneric<SubscriptionManifest>(MANIFEST_ENTRY, files, manifest, assets);
  return buffer;
}

export function extractArchive(
  buffer: Buffer,
): { manifest: SubscriptionManifest; files: PackedFile[]; assets: PackedAsset[] } {
  return extractArchiveGeneric<SubscriptionManifest>(buffer, MANIFEST_ENTRY);
}
