import {
  buildArchive as buildArchiveGeneric,
  extractArchive as extractArchiveGeneric,
  contentHash,
  SUBSCRIPTION_MANIFEST_ENTRY,
  type SubscriptionManifest,
  type PackedFile,
  type PackedAsset,
} from '@pipe/protocol';

export const MANIFEST_ENTRY = SUBSCRIPTION_MANIFEST_ENTRY;

export type { PackedFile, PackedAsset, SubscriptionManifest };
export { contentHash };

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
