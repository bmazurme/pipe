import { describe, expect, it } from 'vitest';

import type { ChatMessageMeta } from '../../store/api';
import { buildContextDraft } from './chatContext';

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
