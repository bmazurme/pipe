import { Logger } from '@nestjs/common';

import type { ChatService } from '../chat/chat.service';
import {
  ChatMessageRole,
  ChatMessageStatus,
} from '../chat/entities/chat-message.entity';
import { RouterClassifierService } from './router-classifier.service';

const USER_ID = 7;
const CHAT_ID = 42;
const ASSISTANT_ID = 100;
const TASK = { title: 'T', body: 'B' };
const OPTIONS = { pollMs: 1, timeoutMs: 50 };

const reply = (status: ChatMessageStatus, content = '') => ({
  id: ASSISTANT_ID,
  role: ChatMessageRole.Assistant,
  status,
  content,
});

describe('RouterClassifierService', () => {
  let chats: {
    createChat: jest.Mock;
    renameChat: jest.Mock;
    sendMessage: jest.Mock;
    listMessages: jest.Mock;
    removeChat: jest.Mock;
  };
  let service: RouterClassifierService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    chats = {
      createChat: jest.fn().mockResolvedValue({ id: CHAT_ID }),
      renameChat: jest.fn().mockResolvedValue(undefined),
      sendMessage: jest
        .fn()
        .mockResolvedValue({ assistantMessage: { id: ASSISTANT_ID } }),
      listMessages: jest.fn(),
      removeChat: jest.fn().mockResolvedValue(undefined),
    };
    service = new RouterClassifierService(chats as unknown as ChatService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the classification of a Complete reply and removes the chat once', async () => {
    chats.listMessages.mockResolvedValue([
      reply(ChatMessageStatus.Complete, '{"tier": 2, "needsGenerated": true}'),
    ]);

    await expect(service.classify(USER_ID, TASK, OPTIONS)).resolves.toEqual({
      tier: 2,
      needsGenerated: true,
    });
    expect(chats.removeChat).toHaveBeenCalledTimes(1);
    expect(chats.removeChat).toHaveBeenCalledWith(CHAT_ID, USER_ID);
  });

  it('keeps polling a Pending reply until it turns Complete', async () => {
    chats.listMessages
      .mockResolvedValueOnce([reply(ChatMessageStatus.Pending)])
      .mockResolvedValueOnce([reply(ChatMessageStatus.Pending)])
      .mockResolvedValueOnce([
        reply(
          ChatMessageStatus.Complete,
          '{"tier": 3, "needsGenerated": false}',
        ),
      ]);

    await expect(service.classify(USER_ID, TASK, OPTIONS)).resolves.toEqual({
      tier: 3,
      needsGenerated: false,
    });
    expect(chats.listMessages).toHaveBeenCalledTimes(3);
    expect(chats.removeChat).toHaveBeenCalledWith(CHAT_ID, USER_ID);
  });

  it('returns null at once for a Failed reply', async () => {
    chats.listMessages.mockResolvedValue([reply(ChatMessageStatus.Failed)]);

    await expect(
      service.classify(USER_ID, TASK, { pollMs: 1, timeoutMs: 5_000 }),
    ).resolves.toBeNull();
    expect(chats.listMessages).toHaveBeenCalledTimes(1);
    expect(chats.removeChat).toHaveBeenCalledWith(CHAT_ID, USER_ID);
  });

  it('returns null after timeoutMs when the reply never completes, and still removes the chat', async () => {
    chats.listMessages.mockResolvedValue([reply(ChatMessageStatus.Pending)]);

    const started = Date.now();

    await expect(
      service.classify(USER_ID, TASK, { pollMs: 1, timeoutMs: 20 }),
    ).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(chats.removeChat).toHaveBeenCalledWith(CHAT_ID, USER_ID);
  });

  it('returns null when sendMessage rejects, and still removes the chat', async () => {
    chats.sendMessage.mockRejectedValue(new Error('boom'));

    await expect(service.classify(USER_ID, TASK, OPTIONS)).resolves.toBeNull();
    expect(chats.listMessages).not.toHaveBeenCalled();
    expect(chats.removeChat).toHaveBeenCalledTimes(1);
    expect(chats.removeChat).toHaveBeenCalledWith(CHAT_ID, USER_ID);
  });

  it('does not propagate a failing removeChat', async () => {
    chats.listMessages.mockResolvedValue([
      reply(ChatMessageStatus.Complete, '{"tier": 1, "needsGenerated": false}'),
    ]);
    chats.removeChat.mockRejectedValue(new Error('cannot delete'));

    await expect(service.classify(USER_ID, TASK, OPTIONS)).resolves.toEqual({
      tier: 1,
      needsGenerated: false,
    });
    expect(chats.removeChat).toHaveBeenCalledWith(CHAT_ID, USER_ID);
  });
});
