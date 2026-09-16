import { createHash } from 'crypto';
import AdmZip from 'adm-zip';

export const MANIFEST_ENTRY = '__subscription_manifest__.json';

export type PackedFile = {
  relPath: string;
  content: string;
};

export type SubscriptionManifest = {
  issueId: string;
  issueIid: string;
  issueTitle: string;
  issueDescription: string;
  projectId: number;
  branch: string;
  createdAt: string;
  contentHash: string;
};

export function contentHash(files: PackedFile[]): string {
  const hash = createHash('sha256');

  for (const file of [...files].sort((a, b) => a.relPath.localeCompare(b.relPath))) {
    hash.update(file.relPath);
    hash.update('\0');
    hash.update(file.content);
    hash.update('\0');
  }

  return hash.digest('hex');
}

export function buildArchive(files: PackedFile[], manifest: Omit<SubscriptionManifest, 'contentHash'>): Buffer {
  const fullManifest: SubscriptionManifest = { ...manifest, contentHash: contentHash(files) };
  const zip = new AdmZip();

  for (const file of files) {
    zip.addFile(file.relPath, Buffer.from(file.content, 'utf-8'));
  }

  zip.addFile(MANIFEST_ENTRY, Buffer.from(JSON.stringify(fullManifest, null, 2), 'utf-8'));

  return zip.toBuffer();
}

export function extractArchive(buffer: Buffer): { manifest: SubscriptionManifest; files: PackedFile[] } {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
  const manifestEntry = entries.find((entry) => entry.entryName === MANIFEST_ENTRY);

  if (!manifestEntry) {
    throw new Error('Архив повреждён: отсутствует манифест посылки');
  }

  const manifest = JSON.parse(manifestEntry.getData().toString('utf-8')) as SubscriptionManifest;
  const files = entries
    .filter((entry) => entry.entryName !== MANIFEST_ENTRY)
    .map((entry) => ({ relPath: entry.entryName, content: entry.getData().toString('utf-8') }));

  return { manifest, files };
}
