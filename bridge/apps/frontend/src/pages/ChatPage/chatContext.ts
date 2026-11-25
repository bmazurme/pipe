import type { ChatMessageMeta } from '../../store/api';
import { MAX_CONTEXT_LENGTH, MAX_CONTEXT_NAME_LENGTH } from '../../store/api';

const TRUNCATION_NOTE = '… (начало диалога опущено — не поместилось в лимит контекста)\n\n';
const MAX_FILENAME_LENGTH = 100;

export interface ContextDraft {
  name: string;
  content: string;
  /** True when the start of the conversation was dropped to fit. */
  truncated: boolean;
  /** How many messages the text covers. */
  messages: number;
}

/**
 * Who said what, one `**Who:** text` block per message, with the names of attached files.
 * Only messages that finished are included — a pending or failed reply has nothing in it.
 */
function messageBlocks(messages: ChatMessageMeta[], modelName: string): string[] {
  const done = messages.filter((message) => message.status === 'complete' && (message.content.trim() || message.attachments?.length));

  return done.map((message) => {
    const who = message.role === 'user' ? 'Пользователь' : modelName;
    const files = (message.attachments ?? []).map((attachment) => attachment.name);
    const attached = files.length > 0 ? `\n(вложения: ${files.join(', ')})` : '';

    return `**${who}:** ${message.content.trim()}${attached}`;
  });
}

/**
 * A chat as plain text for the Context module (see `messageBlocks`).
 * When it does not fit, the *start* is dropped: the latest turns are what a later task needs.
 */
export function buildContextDraft(title: string, messages: ChatMessageMeta[], modelName: string): ContextDraft {
  const blocks = messageBlocks(messages, modelName);

  let content = blocks.join('\n\n');
  let truncated = false;

  if (content.length > MAX_CONTEXT_LENGTH) {
    truncated = true;
    const room = MAX_CONTEXT_LENGTH - TRUNCATION_NOTE.length;
    const tail = content.slice(-room);
    // Cut on a message boundary when there is one near the start, so no reply begins mid-sentence.
    const boundary = tail.indexOf('\n\n**');

    content = TRUNCATION_NOTE + (boundary >= 0 ? tail.slice(boundary + 2) : tail);
  }

  return {
    name: title.trim().slice(0, MAX_CONTEXT_NAME_LENGTH) || 'Чат',
    content,
    truncated,
    messages: blocks.length,
  };
}

/**
 * The whole chat as a Markdown document to download: a title heading, the model and the export
 * date, then every finished message in order. Unlike a Context draft it is never truncated.
 */
export function buildChatMarkdown(title: string, messages: ChatMessageMeta[], modelName: string, exportedAt: Date = new Date()): string {
  const heading = `# ${title.trim() || 'Чат'}`;
  const meta = `_Модель: ${modelName} · экспортировано ${exportedAt.toLocaleString('ru-RU')}_`;

  return `${[heading, meta, ...messageBlocks(messages, modelName)].join('\n\n')}\n`;
}

/** A file name for the downloaded chat: its title without characters file systems reject. */
export function chatMarkdownFilename(title: string | null | undefined, chatId: number): string {
  const safe = (title ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+/, '')
    .slice(0, MAX_FILENAME_LENGTH)
    .trim();

  return `${safe || `chat-${chatId}`}.md`;
}
