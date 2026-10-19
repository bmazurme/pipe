import { MAX_TOTAL_IMAGE_BYTES, type IssueImage } from '@pipe/protocol';

// Screenshots the person attaches to a task when pushing it: they travel in the parcel next to the images
// the issue itself carries (issue-images/…), so the worker sees them the same way.
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

export interface AttachmentPayload {
  name: string;
  base64: string;
}

// What an image really is, from its first bytes — the name and the declared type come from the browser and prove nothing.
const SIGNATURES: { extension: string; matches: (bytes: Buffer) => boolean }[] = [
  { extension: 'png', matches: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { extension: 'jpg', matches: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { extension: 'gif', matches: (b) => b.length > 6 && ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1')) },
  { extension: 'webp', matches: (b) => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

function safeStem(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const stem = base.replace(/\.[^.]*$/, '').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^[-.]+|[-.]+$/g, '');

  return stem.slice(0, 60) || 'screenshot';
}

// Checks what the client sent and turns it into parcel images, or throws a message the person can act on.
// `taken` are the names already used by the images downloaded from the issue.
export function parseAttachments(raw: unknown, taken: Iterable<string> = []): IssueImage[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error('Вложения переданы в неверном формате');
  if (raw.length > MAX_ATTACHMENTS) throw new Error(`Слишком много скриншотов: не больше ${MAX_ATTACHMENTS}`);

  const used = new Set(taken);
  const images: IssueImage[] = [];
  let total = 0;

  raw.forEach((item, index) => {
    const { name, base64 } = (item ?? {}) as Partial<AttachmentPayload>;
    if (typeof name !== 'string' || typeof base64 !== 'string' || base64.length === 0) {
      throw new Error(`Вложение ${index + 1}: нет имени или содержимого`);
    }

    const bytes = Buffer.from(base64, 'base64');
    const label = name || `вложение ${index + 1}`;

    if (bytes.length === 0) throw new Error(`«${label}» пустой`);
    if (bytes.length > MAX_ATTACHMENT_BYTES) {
      throw new Error(`«${label}» больше ${MAX_ATTACHMENT_BYTES / 1024 / 1024} МБ`);
    }

    const signature = SIGNATURES.find((candidate) => candidate.matches(bytes));
    if (!signature) throw new Error(`«${label}» — не изображение (PNG, JPEG, GIF или WebP)`);

    total += bytes.length;
    if (total > MAX_TOTAL_IMAGE_BYTES) throw new Error('Скриншоты вместе превышают общий лимит посылки');

    let fileName = `${safeStem(name)}.${signature.extension}`;
    for (let counter = 2; used.has(fileName); counter += 1) {
      fileName = `${safeStem(name)}-${counter}.${signature.extension}`;
    }
    used.add(fileName);

    images.push({ relPath: `issue-images/${fileName}`, base64: bytes.toString('base64') });
  });

  return images;
}
