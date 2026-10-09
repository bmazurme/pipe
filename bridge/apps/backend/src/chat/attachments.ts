import { extname } from 'node:path';

// What may be attached to a chat message. Only Claude chats take attachments: Claude Code
// reads these files itself (images included), the other providers here get text only.
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
// Everything attached to one chat, so a long conversation cannot grow a worker's turn
// directory without bound.
export const MAX_ATTACHMENTS_PER_CHAT = 30;

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

// By extension, not by the browser-supplied type (which a client can set to anything).
// Plain-text and source formats only: no archives, no executables, and no `.env`.
const TEXT_EXTENSIONS = [
  '.pdf',
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.csv',
  '.tsv',
  '.log',
  '.yml',
  '.yaml',
  '.toml',
  '.xml',
  '.html',
  '.css',
  '.js',
  '.jsx',
  '.mjs',
  '.ts',
  '.tsx',
  '.py',
  '.java',
  '.kt',
  '.go',
  '.rs',
  '.rb',
  '.php',
  '.c',
  '.h',
  '.cpp',
  '.cs',
  '.sh',
  '.sql',
  '.diff',
  '.patch',
];

export const ALLOWED_ATTACHMENT_EXTENSIONS = [
  ...IMAGE_EXTENSIONS,
  ...TEXT_EXTENSIONS,
];

export function isAllowedAttachment(originalName: string): boolean {
  return ALLOWED_ATTACHMENT_EXTENSIONS.includes(
    extname(originalName).toLowerCase(),
  );
}

export function isImageAttachment(originalName: string): boolean {
  return IMAGE_EXTENSIONS.includes(extname(originalName).toLowerCase());
}

// The reply's content type for an image, so a browser previews it; anything else is
// served as an opaque download.
export function contentTypeOf(originalName: string): string {
  switch (extname(originalName).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}
