import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';

import { ChatService } from './chat.service';
import { ChatAttachment } from './entities/chat-attachment.entity';
import { Chat, ChatModel } from './entities/chat.entity';
import {
  ChatMessage,
  ChatMessageRole,
  ChatMessageStatus,
} from './entities/chat-message.entity';

type MockRepository<T extends object> = Partial<
  Record<keyof Repository<T>, jest.Mock>
>;

function createMockRepository<T extends object>(): MockRepository<T> {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    findOneByOrFail: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    query: jest.fn(),
  };
}

describe('ChatService', () => {
  let service: ChatService;
  let chatRepository: MockRepository<Chat>;
  let messageRepository: MockRepository<ChatMessage>;
  let attachmentRepository: MockRepository<ChatAttachment>;

  beforeEach(async () => {
    chatRepository = createMockRepository<Chat>();
    messageRepository = createMockRepository<ChatMessage>();
    // No attachments unless a test adds some.
    attachmentRepository = createMockRepository<ChatAttachment>();
    attachmentRepository.find!.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: getRepositoryToken(Chat), useValue: chatRepository },
        {
          provide: getRepositoryToken(ChatMessage),
          useValue: messageRepository,
        },
        {
          provide: getRepositoryToken(ChatAttachment),
          useValue: attachmentRepository,
        },
      ],
    }).compile();

    service = module.get(ChatService);
  });

  describe('createChat', () => {
    it('saves a new chat for the given model', async () => {
      chatRepository.save!.mockImplementation((c) =>
        Promise.resolve({ id: 1, ...c }),
      );

      const chat = await service.createChat(7, { model: ChatModel.Gpt });

      expect(chatRepository.save).toHaveBeenCalledWith({
        userId: 7,
        model: ChatModel.Gpt,
        title: null,
      });
      expect(chat).toMatchObject({ id: 1, model: ChatModel.Gpt });
    });
  });

  describe('findOwnedChat', () => {
    it('throws NotFoundException when the chat does not belong to the user', async () => {
      chatRepository.findOne!.mockResolvedValue(null);
      await expect(service.findOwnedChat(1, 7)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('renameChat', () => {
    it('updates the title of an owned chat', async () => {
      chatRepository.findOne!.mockResolvedValue({
        id: 1,
        userId: 7,
        title: null,
      });
      chatRepository.save!.mockImplementation(async (chat) => chat);

      const result = await service.renameChat(1, 7, 'New title');

      expect(chatRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, title: 'New title' }),
      );
      expect(result.title).toBe('New title');
    });

    it('throws NotFoundException for a chat owned by someone else', async () => {
      chatRepository.findOne!.mockResolvedValue(null);
      await expect(service.renameChat(1, 7, 'New title')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('removeChat', () => {
    it('deletes an owned chat', async () => {
      chatRepository.findOne!.mockResolvedValue({ id: 1, userId: 7 });
      await service.removeChat(1, 7);
      expect(chatRepository.delete).toHaveBeenCalledWith(1);
    });
  });

  describe('listMessages', () => {
    it('throws NotFoundException for a chat owned by someone else', async () => {
      chatRepository.findOne!.mockResolvedValue(null);
      await expect(service.listMessages(1, 7)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns messages ordered by createdAt ascending', async () => {
      chatRepository.findOne!.mockResolvedValue({ id: 1, userId: 7 });
      messageRepository.find!.mockResolvedValue([]);

      await service.listMessages(1, 7);

      expect(messageRepository.find).toHaveBeenCalledWith({
        where: { chatId: 1 },
        order: { createdAt: 'ASC' },
      });
    });
  });

  describe('sendMessage', () => {
    it('creates a complete user message and a pending assistant message', async () => {
      const chat = { id: 1, userId: 7 };
      chatRepository.findOne!.mockResolvedValue(chat);
      chatRepository.save!.mockResolvedValue(chat);
      messageRepository
        .save!.mockImplementationOnce((m) => Promise.resolve({ id: 10, ...m }))
        .mockImplementationOnce((m) => Promise.resolve({ id: 11, ...m }));

      const { userMessage, assistantMessage } = await service.sendMessage(
        1,
        7,
        'hello',
      );

      expect(messageRepository.save).toHaveBeenNthCalledWith(1, {
        chatId: 1,
        role: ChatMessageRole.User,
        content: 'hello',
        status: ChatMessageStatus.Complete,
      });
      expect(messageRepository.save).toHaveBeenNthCalledWith(2, {
        chatId: 1,
        role: ChatMessageRole.Assistant,
        content: '',
        status: ChatMessageStatus.Pending,
      });
      expect(userMessage.id).toBe(10);
      expect(assistantMessage.id).toBe(11);
      expect(assistantMessage.status).toBe(ChatMessageStatus.Pending);
      // Bumps the chat's own updatedAt so the most-recently-active chat sorts first.
      expect(chatRepository.save).toHaveBeenCalledWith(chat);
    });
  });

  describe('claim', () => {
    // node-postgres (via TypeORM's Repository.query) returns
    // [rows, affectedCount] for an UPDATE, not a flat rows array — these
    // mocks match that real shape, not a plain SELECT's.
    it('returns null when nothing is pending', async () => {
      messageRepository.query!.mockResolvedValue([[], 0]);
      await expect(service.claim(7)).resolves.toBeNull();
    });

    it('claims the oldest pending message atomically and returns history excluding the claimed placeholder', async () => {
      messageRepository.query!.mockResolvedValue([[{ id: 99 }], 1]);
      messageRepository.findOneByOrFail!.mockResolvedValue({
        id: 99,
        chatId: 1,
        role: ChatMessageRole.Assistant,
        content: '',
        status: ChatMessageStatus.Running,
      });
      chatRepository.findOneByOrFail!.mockResolvedValue({
        id: 1,
        userId: 7,
        model: ChatModel.Sonnet,
      });
      messageRepository.find!.mockResolvedValue([
        {
          id: 98,
          role: ChatMessageRole.User,
          content: 'hi',
          status: ChatMessageStatus.Complete,
        },
        {
          id: 99,
          role: ChatMessageRole.Assistant,
          content: '',
          status: ChatMessageStatus.Running,
        },
      ]);

      const result = await service.claim(7);

      expect(messageRepository.query).toHaveBeenCalledWith(
        expect.stringContaining('FOR UPDATE OF cm SKIP LOCKED'),
        [ChatMessageStatus.Running, ChatMessageStatus.Pending, 7],
      );
      expect(result?.message.id).toBe(99);
      expect(result?.chat.model).toBe(ChatModel.Sonnet);
      expect(result?.history).toEqual([
        { role: ChatMessageRole.User, content: 'hi' },
      ]);
    });

    it('excludes failed and pending assistant placeholders from history', async () => {
      messageRepository.query!.mockResolvedValue([[{ id: 103 }], 1]);
      messageRepository.findOneByOrFail!.mockResolvedValue({
        id: 103,
        chatId: 1,
        role: ChatMessageRole.Assistant,
        content: '',
        status: ChatMessageStatus.Running,
      });
      chatRepository.findOneByOrFail!.mockResolvedValue({ id: 1, userId: 7 });
      messageRepository.find!.mockResolvedValue([
        {
          id: 100,
          role: ChatMessageRole.User,
          content: 'first',
          status: ChatMessageStatus.Complete,
        },
        {
          id: 101,
          role: ChatMessageRole.Assistant,
          content: '',
          status: ChatMessageStatus.Failed,
        },
        {
          id: 102,
          role: ChatMessageRole.User,
          content: 'second',
          status: ChatMessageStatus.Complete,
        },
        {
          id: 103,
          role: ChatMessageRole.Assistant,
          content: '',
          status: ChatMessageStatus.Running,
        },
        {
          id: 104,
          role: ChatMessageRole.Assistant,
          content: '',
          status: ChatMessageStatus.Pending,
        },
      ]);

      const result = await service.claim(7);

      expect(result?.history).toEqual([
        { role: ChatMessageRole.User, content: 'first' },
        { role: ChatMessageRole.User, content: 'second' },
      ]);
      expect(result?.history.some((h) => h.content === '')).toBe(false);
    });
  });

  describe.each([
    ['completeTurn', (id: number) => service.completeTurn(id, 7, 'x')],
    ['failTurn', (id: number) => service.failTurn(id, 7, 'x')],
  ])('%s state guard', (_name, call) => {
    beforeEach(() => {
      chatRepository.findOne!.mockResolvedValue({ id: 1, userId: 7 });
    });

    it('rejects a user-role message without saving', async () => {
      messageRepository.findOne!.mockResolvedValue({
        id: 98,
        chatId: 1,
        role: ChatMessageRole.User,
        content: 'hi',
        status: ChatMessageStatus.Running,
      });

      await expect(call(98)).rejects.toThrow(BadRequestException);
      expect(messageRepository.save).not.toHaveBeenCalled();
    });

    it.each([ChatMessageStatus.Complete, ChatMessageStatus.Failed])(
      'rejects an assistant message already %s without saving',
      async (status) => {
        messageRepository.findOne!.mockResolvedValue({
          id: 99,
          chatId: 1,
          role: ChatMessageRole.Assistant,
          content: 'done',
          status,
        });

        await expect(call(99)).rejects.toThrow(ConflictException);
        expect(messageRepository.save).not.toHaveBeenCalled();
      },
    );

    it('succeeds for a running assistant message', async () => {
      messageRepository.findOne!.mockResolvedValue({
        id: 99,
        chatId: 1,
        role: ChatMessageRole.Assistant,
        content: '',
        status: ChatMessageStatus.Running,
      });
      messageRepository.save!.mockImplementation((m) => Promise.resolve(m));

      await expect(call(99)).resolves.toMatchObject({ id: 99 });
      expect(messageRepository.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('completeTurn', () => {
    it('fills the message content and marks it complete', async () => {
      messageRepository.findOne!.mockResolvedValue({
        id: 99,
        chatId: 1,
        role: ChatMessageRole.Assistant,
        content: '',
        status: ChatMessageStatus.Running,
      });
      chatRepository.findOne!.mockResolvedValue({ id: 1, userId: 7 });
      messageRepository.save!.mockImplementation((m) => Promise.resolve(m));

      const result = await service.completeTurn(99, 7, 'the answer');

      expect(result.content).toBe('the answer');
      expect(result.status).toBe(ChatMessageStatus.Complete);
    });

    it.each([ChatMessageStatus.Complete, ChatMessageStatus.Failed])(
      'throws ConflictException and leaves a %s message unchanged',
      async (status) => {
        const stored = {
          id: 99,
          chatId: 1,
          role: ChatMessageRole.Assistant,
          content: 'original',
          status,
        };
        messageRepository.findOne!.mockResolvedValue(stored);
        chatRepository.findOne!.mockResolvedValue({ id: 1, userId: 7 });

        await expect(service.completeTurn(99, 7, 'late')).rejects.toThrow(
          ConflictException,
        );
        expect(stored.content).toBe('original');
        expect(stored.status).toBe(status);
        expect(messageRepository.save).not.toHaveBeenCalled();
      },
    );

    it('throws NotFoundException for a message in a chat owned by someone else', async () => {
      messageRepository.findOne!.mockResolvedValue({ id: 99, chatId: 1 });
      chatRepository.findOne!.mockResolvedValue(null);

      await expect(service.completeTurn(99, 7, 'x')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('failTurn', () => {
    it('marks the message failed with the given error message', async () => {
      messageRepository.findOne!.mockResolvedValue({
        id: 99,
        chatId: 1,
        role: ChatMessageRole.Assistant,
        status: ChatMessageStatus.Running,
      });
      chatRepository.findOne!.mockResolvedValue({ id: 1, userId: 7 });
      messageRepository.save!.mockImplementation((m) => Promise.resolve(m));

      const result = await service.failTurn(99, 7, 'boom');

      expect(result.status).toBe(ChatMessageStatus.Failed);
      expect(result.errorMessage).toBe('boom');
    });

    it.each([ChatMessageStatus.Complete, ChatMessageStatus.Failed])(
      'throws ConflictException for a %s message',
      async (status) => {
        const stored = {
          id: 99,
          chatId: 1,
          role: ChatMessageRole.Assistant,
          content: 'original',
          status,
        };
        messageRepository.findOne!.mockResolvedValue(stored);
        chatRepository.findOne!.mockResolvedValue({ id: 1, userId: 7 });

        await expect(service.failTurn(99, 7, 'boom')).rejects.toThrow(
          ConflictException,
        );
        expect(stored.status).toBe(status);
        expect(messageRepository.save).not.toHaveBeenCalled();
      },
    );
  });
});
