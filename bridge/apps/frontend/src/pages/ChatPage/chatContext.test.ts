import { describe, expect, it } from 'vitest';

import type { ChatMessageMeta } from '../../store/api';
import { buildChatMarkdown, buildContextDraft, chatMarkdownFilename } from './chatContext';

const message = (id: number, role: 'user' | 'assistant', content: string, over: Partial<ChatMessageMeta> = {}): ChatMessageMeta => ({
  id,
  chatId: 1,
  role,
  content,
  status: 'complete',
  errorMessage: null,
  attachments: [],
  createdAt: '2026-10-09T00:00:00Z',
  updatedAt: '2026-10-09T00:00:00Z',
  ...over,
});

describe('buildContextDraft', () => {
  it('writes who said what, in order, and names the model', () => {
    const draft = buildContextDraft('Парсер', [message(1, 'user', 'Как разбирать даты?'), message(2, 'assistant', 'Используйте date-fns.')], 'Claude Sonnet');

    expect(draft.name).toBe('Парсер');
    expect(draft.content).toBe('**Пользователь:** Как разбирать даты?\n\n**Claude Sonnet:** Используйте date-fns.');
    expect(draft).toMatchObject({ truncated: false, messages: 2 });
  });

  it('lists attached files by name', () => {
    const draft = buildContextDraft('x', [message(1, 'user', 'смотри', { attachments: [{ id: 1, name: 'err.png', size: 5, isImage: true, messageId: 1 }, { id: 2, name: 'log.txt', size: 5, isImage: false, messageId: 1 }] })], 'Claude');

    expect(draft.content).toContain('(вложения: err.png, log.txt)');
  });

  it('leaves out replies that are still pending or failed, and empty ones', () => {
    const draft = buildContextDraft(
      'x',
      [message(1, 'user', 'hi'), message(2, 'assistant', '', { status: 'pending' }), message(3, 'assistant', '⚠️ boom', { status: 'failed' }), message(4, 'user', '   ')],
      'Claude',
    );

    expect(draft.content).toBe('**Пользователь:** hi');
    expect(draft.messages).toBe(1);
  });

  it('keeps the end of a long chat, starting at a message, and says the start was dropped', () => {
    const many = Array.from({ length: 200 }, (_, i) => message(i + 1, i % 2 ? 'assistant' : 'user', `${i}: ${'слово '.repeat(40)}`));
    const draft = buildContextDraft('long', many, 'Claude');

    expect(draft.truncated).toBe(true);
    expect(draft.content.length).toBeLessThanOrEqual(20_000);
    expect(draft.content.startsWith('… (начало диалога опущено')).toBe(true);
    expect(draft.content).toContain('199:');
    expect(draft.content).not.toContain('**Пользователь:** 0:');
    // The first kept block is a whole message, not the middle of one.
    expect(draft.content.split('\n\n')[1].startsWith('**')).toBe(true);
  });

  it('bounds the name and falls back to a default for an empty title', () => {
    expect(buildContextDraft('я'.repeat(300), [], 'Claude').name.length).toBe(100);
    expect(buildContextDraft('  ', [], 'Claude').name).toBe('Чат');
  });
});

describe('buildChatMarkdown', () => {
  const at = new Date('2026-10-16T12:00:00Z');

  it('starts with the title heading and the model, then who said what, in order', () => {
    const markdown = buildChatMarkdown('Парсер', [message(1, 'user', 'Как разбирать даты?'), message(2, 'assistant', 'Используйте date-fns.')], 'Claude Sonnet', at);
    const [heading, meta, ...blocks] = markdown.trimEnd().split('\n\n');

    expect(heading).toBe('# Парсер');
    expect(meta).toContain('Модель: Claude Sonnet');
    expect(meta).toContain(at.toLocaleString('ru-RU'));
    expect(blocks).toEqual(['**Пользователь:** Как разбирать даты?', '**Claude Sonnet:** Используйте date-fns.']);
  });

  it('never truncates a chat longer than the context limit', () => {
    const many = Array.from({ length: 200 }, (_, i) => message(i + 1, i % 2 ? 'assistant' : 'user', `${i}: ${'слово '.repeat(40)}`));
    const markdown = buildChatMarkdown('long', many, 'Claude', at);

    expect(markdown.length).toBeGreaterThan(20_000);
    expect(markdown).not.toContain('начало диалога опущено');
    expect(markdown).toContain('**Пользователь:** 0:');
    expect(markdown).toContain('199:');
  });

  it('leaves out pending, failed and empty messages', () => {
    const markdown = buildChatMarkdown(
      'x',
      [message(1, 'user', 'hi'), message(2, 'assistant', '', { status: 'pending' }), message(3, 'assistant', '⚠️ boom', { status: 'failed' }), message(4, 'user', '   ')],
      'Claude',
      at,
    );

    expect(markdown.trimEnd().split('\n\n').slice(2)).toEqual(['**Пользователь:** hi']);
  });

  it('lists attached files by name', () => {
    const markdown = buildChatMarkdown('x', [message(1, 'user', 'смотри', { attachments: [{ id: 1, name: 'err.png', size: 5, isImage: true, messageId: 1 }] })], 'Claude', at);

    expect(markdown).toContain('(вложения: err.png)');
  });

  it('falls back to a default heading for an empty title', () => {
    expect(buildChatMarkdown('  ', [], 'Claude', at).startsWith('# Чат\n')).toBe(true);
  });
});

describe('chatMarkdownFilename', () => {
  it('uses the chat title, without characters a file name cannot hold', () => {
    expect(chatMarkdownFilename('Парсер: даты/время?', 7)).toBe('Парсер даты время.md');
  });

  it('falls back to chat-<id> when there is no usable title', () => {
    expect(chatMarkdownFilename(null, 7)).toBe('chat-7.md');
    expect(chatMarkdownFilename(' / ', 7)).toBe('chat-7.md');
    expect(chatMarkdownFilename('..', 7)).toBe('chat-7.md');
  });

  it('bounds the length of a long title', () => {
    expect(chatMarkdownFilename('я'.repeat(300), 1)).toBe(`${'я'.repeat(100)}.md`);
  });
});
