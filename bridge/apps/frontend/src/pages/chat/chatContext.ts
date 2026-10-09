import type { ChatMessageMeta } from '../../store/api';
import { MAX_CONTEXT_LENGTH, MAX_CONTEXT_NAME_LENGTH } from '../../store/api';

const TRUNCATION_NOTE = '… (начало диалога опущено — не поместилось в лимит контекста)\n\n';

export interface ContextDraft {
  name: string;
  content: string;
  /** True when the start of the conversation was dropped to fit. */
  truncated: boolean;
  /** How many messages the text covers. */
  messages: number;
}

/**
 * A chat as plain text for the Context module: who said what, with the names of attached
 * files. Only messages that finished are included — a pending or failed reply has nothing in it.
 * When it does not fit, the *start* is dropped: the latest turns are what a later task needs.
 */
export function buildContextDraft(title: string, messages: ChatMessageMeta[], modelName: string): ContextDraft {
  const done = messages.filter((message) => message.status === 'complete' && (message.content.trim() || message.attachments?.length));
  const blocks = done.map((message) => {
    const who = message.role === 'user' ? 'Пользователь' : modelName;
    const files = (message.attachments ?? []).map((attachment) => attachment.name);
    const attached = files.length > 0 ? `\n(вложения: ${files.join(', ')})` : '';

    return `**${who}:** ${message.content.trim()}${attached}`;
  });

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
    messages: done.length,
  };
}
