// Turning a post into what the Bot API takes. The owner writes plain text with **bold** (and `code`) marks; Telegram gets HTML, so the
// text is escaped first and only those marks become tags — nothing else in a post can ever be read as markup.

// **bold**: the mark opens right before a word and closes right after one, so a stray `**` («2 ** 3») never pairs with a later one.
const BOLD = /\*\*([^*\s](?:[^*\n]*?[^*\s])?)\*\*/g;

export function toTelegramHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped
    .replace(BOLD, '<b>$1</b>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>');
}

// The length Telegram counts for the caption limit: what a reader sees, without the marks.
export function visibleText(text: string): string {
  return text.replace(BOLD, '$1').replace(/`([^`\n]+)`/g, '$1');
}

export interface MediaFile {
  id: number;
  name: string;
  mime: string;
  size: number;
}

export type SendPlan =
  | { kind: 'text' }
  | {
      kind: 'single';
      method: 'sendPhoto' | 'sendVideo' | 'sendAnimation';
      field: 'photo' | 'video' | 'animation';
      file: MediaFile;
    }
  | { kind: 'group'; files: MediaFile[] };

// What the Bot API accepts when the bot uploads a file itself: a photo up to 10 MB, anything else up to 50 MB.
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const GROUP_MAX_FILES = 10;

const mb = (n: number) => `${Math.round(n / 1024 / 1024)} МБ`;

// How a post with these files goes out, or why it cannot: no files = a message; one = a photo, a video or a gif with the text as its
// caption; two to ten = an album, the text under the first. Throws the reason in the owner's words.
export function planSend(files: MediaFile[]): SendPlan {
  if (files.length === 0) return { kind: 'text' };

  for (const file of files) {
    const isPhoto = file.mime.startsWith('image/') && file.mime !== 'image/gif';
    const limit = isPhoto ? PHOTO_MAX_BYTES : UPLOAD_MAX_BYTES;

    if (file.size > limit) {
      throw new Error(
        `«${file.name}» больше ${mb(limit)}: Telegram не принимает такой файл от бота`,
      );
    }
  }

  if (files.length === 1) {
    const [file] = files;

    if (file.mime === 'image/gif') {
      return {
        kind: 'single',
        method: 'sendAnimation',
        field: 'animation',
        file,
      };
    }

    return file.mime.startsWith('video/')
      ? { kind: 'single', method: 'sendVideo', field: 'video', file }
      : { kind: 'single', method: 'sendPhoto', field: 'photo', file };
  }

  if (files.length > GROUP_MAX_FILES) {
    throw new Error(`В альбоме Telegram не больше ${GROUP_MAX_FILES} файлов`);
  }

  const gif = files.find((file) => file.mime === 'image/gif');

  if (gif) {
    throw new Error(
      `Гифка «${gif.name}» уходит только одним файлом, не в альбоме`,
    );
  }

  return { kind: 'group', files };
}

// A link to a message: a public chat has a name, a private one is addressed as t.me/c/<id without the -100>.
export function messageUrl(
  target: { chatId: string; username: string | null },
  messageId: number,
): string | null {
  if (target.username) return `https://t.me/${target.username}/${messageId}`;

  return target.chatId.startsWith('-100')
    ? `https://t.me/c/${target.chatId.slice(4)}/${messageId}`
    : null;
}

// What the owner may type to bind a chat: a numeric id, @name or a t.me/name link. A private invite link (t.me/+…) names no chat.
export function parseChatRef(input: string): string | null {
  const value = input.trim();

  if (/^-?\d{5,}$/.test(value)) return value;

  const name =
    /^(?:https?:\/\/)?(?:t\.me\/|telegram\.me\/)?@?([A-Za-z][A-Za-z0-9_]{3,31})\/?$/.exec(
      value,
    );

  return name ? `@${name[1]}` : null;
}
