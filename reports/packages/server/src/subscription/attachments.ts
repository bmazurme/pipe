import { MAX_TOTAL_IMAGE_BYTES, type IssueImage } from '@pipe/protocol';

// Files the person attaches to a task when pushing it. A picture travels next to the images the issue itself carries
// (issue-images/…), so the worker sees it the same way; any other file (.msg, .json, .txt, a log, …) goes to issue-attachments/…,
// where the worker reads it as input. Neither kind passes the dictionary substitution or the leak scan — they are sent as they are.
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const ATTACHMENTS_DIR = 'issue-attachments/';

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

function safeStem(name: string, fallback = 'file'): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const stem = base.replace(/\.[^.]*$/, '').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^[-.]+|[-.]+$/g, '');

  return stem.slice(0, 60) || fallback;
}

// The extension of a file that is not a picture, as the name gives it (a file has nothing else to tell what it is): short, letters
// and digits only, lower case — or none.
function safeExtension(name: string): string {
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(name.split(/[\\/]/).pop() ?? '');

  return match ? match[1].toLowerCase() : '';
}

// Checks what the client sent and turns it into parcel images, or throws a message the person can act on.
// `taken` are the names already used by the images downloaded from the issue.
export function parseAttachments(raw: unknown, taken: Iterable<string> = []): IssueImage[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error('Вложения переданы в неверном формате');
  if (raw.length > MAX_ATTACHMENTS) throw new Error(`Слишком много вложений: не больше ${MAX_ATTACHMENTS}`);

  // `taken` are file names inside issue-images/ (what the issue's own images are called).
  const used = new Set([...taken].map((name) => `issue-images/${name}`));
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

    total += bytes.length;
    if (total > MAX_TOTAL_IMAGE_BYTES) throw new Error('Вложения вместе превышают общий лимит посылки');

    // A picture is recognised by its first bytes; anything else is an ordinary file under its own (cleaned) name.
    const signature = SIGNATURES.find((candidate) => candidate.matches(bytes));
    const dir = signature ? 'issue-images/' : ATTACHMENTS_DIR;
    const stem = safeStem(name, signature ? 'screenshot' : 'file');
    const extension = signature ? signature.extension : safeExtension(name);
    const suffix = extension ? `.${extension}` : '';

    let fileName = `${stem}${suffix}`;
    for (let counter = 2; used.has(`${dir}${fileName}`); counter += 1) {
      fileName = `${stem}-${counter}${suffix}`;
    }
    used.add(`${dir}${fileName}`);

    images.push({ relPath: `${dir}${fileName}`, base64: bytes.toString('base64') });
  });

  return images;
}
