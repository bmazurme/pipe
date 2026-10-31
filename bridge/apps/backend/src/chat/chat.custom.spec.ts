import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ContextService } from '../context/context.service';
import { FILE_STORE } from '../storage/file-store/file-store';
import { ProviderCredentialsService } from '../worker/provider-credentials.service';
import { WorkerService } from '../worker/worker.service';
import { ChatAttachmentsService } from './chat-attachments.service';
import { ChatService } from './chat.service';
import { ChatAttachment } from './entities/chat-attachment.entity';
import { Chat, ChatModel } from './entities/chat.entity';
import { ChatMessage } from './entities/chat-message.entity';

// A chat on a custom model: any OpenAI-compatible server, named by the stored key the chat points at.
describe('ChatService — custom model', () => {
  let service: ChatService;
  const chats = {
    save: jest.fn(async (chat: object) => ({ id: 1, ...chat })),
    findOne: jest.fn(),
    findOneByOrFail: jest.fn(),
  };
  const messages = {
    count: jest.fn().mockResolvedValue(0),
    query: jest.fn().mockResolvedValue([[], 0]),
  };
  const attachments = { find: jest.fn().mockResolvedValue([]) };
  const keys = { existsFor: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    keys.existsFor.mockResolvedValue(true);
    chats.findOne.mockResolvedValue({
      id: 1,
      userId: 7,
      model: ChatModel.Custom,
      providerCredentialId: 3,
    });

    const module = await Test.createTestingModule({
      providers: [
        ChatService,
        {
          provide: ChatAttachmentsService,
          useValue: { findByChat: jest.fn().mockResolvedValue([]) },
        },
        { provide: getRepositoryToken(Chat), useValue: chats },
        { provide: getRepositoryToken(ChatMessage), useValue: messages },
        { provide: getRepositoryToken(ChatAttachment), useValue: attachments },
        { provide: FILE_STORE, useValue: {} },
        { provide: ContextService, useValue: { findOwned: jest.fn() } },
        { provide: WorkerService, useValue: { findOwned: jest.fn() } },
        { provide: ProviderCredentialsService, useValue: keys },
      ],
    }).compile();

    service = module.get(ChatService);
  });

  describe('createChat', () => {
    it('needs the key of the server, and it must be the owner’s own custom key', async () => {
      await expect(
        service.createChat(7, { model: ChatModel.Custom }),
      ).rejects.toBeInstanceOf(BadRequestException);

      keys.existsFor.mockResolvedValue(false);
      await expect(
        service.createChat(7, {
          model: ChatModel.Custom,
          providerCredentialId: 99,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(keys.existsFor).toHaveBeenCalledWith(99, 7, 'custom');
      expect(chats.save).not.toHaveBeenCalled();
    });

    it('stores the key on a custom chat, and none on any other', async () => {
      await service.createChat(7, {
        model: ChatModel.Custom,
        providerCredentialId: 3,
      });
      expect(chats.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ model: 'custom', providerCredentialId: 3 }),
      );

      await service.createChat(7, {
        model: ChatModel.Gpt,
        providerCredentialId: 3,
      });
      expect(chats.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ model: 'gpt', providerCredentialId: null }),
      );
    });
  });

  describe('changeModel', () => {
    it('moves a custom chat to another server with a key alone', async () => {
      const chat = await service.changeModel(1, 7, undefined, 4);

      expect(chat).toMatchObject({ model: 'custom', providerCredentialId: 4 });
      expect(keys.existsFor).toHaveBeenCalledWith(4, 7, 'custom');
    });

    it('keeps the key when the model is "changed" to custom again, and clears it when leaving custom', async () => {
      expect(await service.changeModel(1, 7, ChatModel.Custom)).toMatchObject({
        providerCredentialId: 3,
      });

      chats.findOne.mockResolvedValue({
        id: 1,
        userId: 7,
        model: ChatModel.Custom,
        providerCredentialId: 3,
      });
      expect(await service.changeModel(1, 7, ChatModel.Opus)).toMatchObject({
        model: 'opus',
        providerCredentialId: null,
      });
    });

    it('refuses a switch to custom without a key', async () => {
      chats.findOne.mockResolvedValue({
        id: 1,
        userId: 7,
        model: ChatModel.Sonnet,
        providerCredentialId: null,
      });

      await expect(
        service.changeModel(1, 7, ChatModel.Custom),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.changeModel(1, 7, ChatModel.Custom, 3),
      ).resolves.toMatchObject({
        providerCredentialId: 3,
      });
    });

    it('refuses a custom model on a chat with attachments (only Claude reads them)', async () => {
      chats.findOne.mockResolvedValue({
        id: 1,
        userId: 7,
        model: ChatModel.Sonnet,
        providerCredentialId: null,
      });
      const module = service as unknown as {
        chatAttachments: { findByChat: jest.Mock };
      };

      module.chatAttachments.findByChat.mockResolvedValue([{ id: 1 }]);
      await expect(
        service.changeModel(1, 7, ChatModel.Custom, 3),
      ).rejects.toThrow(/вложения/);
    });
  });

  describe('claim', () => {
    const sqlOf = () => messages.query.mock.calls[0] as [string, unknown[]];

    it('gives a legacy worker and a worker that is too old no custom chat', async () => {
      await service.claim(7, null);
      expect(sqlOf()[0]).toContain(`c.model::text <> 'custom'`);
      expect(sqlOf()[0]).not.toContain('allowedWorkerIds');
      expect(sqlOf()[1]).toHaveLength(3);

      messages.query.mockClear();
      await service.claim(7, { id: 5, version: '0.1.0' });
      expect(sqlOf()[1]).toHaveLength(3);
    });

    it('limits a current worker to the chats whose key allows it', async () => {
      await service.claim(7, { id: 5, version: '0.2.0' });

      expect(sqlOf()[0]).toContain(
        '"allowedWorkerIds" IS NULL OR $4 = ANY("allowedWorkerIds")',
      );
      expect(sqlOf()[1]).toEqual(['running', 'pending', 7, 5]);
    });
  });
});
