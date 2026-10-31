import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { In } from 'typeorm';

import { CHAT_UPLOAD_DIR } from './config/attachment-multer.config';
import { UPLOAD_ROOT as UPLOAD_DIR } from '../uploads/upload-files';
import { FILE_STORE } from '../storage/file-store/file-store';
import { LocalFileStore } from '../storage/file-store/local-file-store';
import { ContextService } from '../context/context.service';
import { ProviderCredentialsService } from '../worker/provider-credentials.service';
import { WorkerService } from '../worker/worker.service';
import { ChatAttachmentsService } from './chat-attachments.service';
import { ChatService } from './chat.service';
import { Chat, ChatModel } from './entities/chat.entity';
import { ChatAttachment } from './entities/chat-attachment.entity';
import {
  ChatMessage,
  ChatMessageRole,
  ChatMessageStatus,
} from './entities/chat-message.entity';

const repo = () => ({
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn(),
  findOneByOrFail: jest.fn(),
  count: jest.fn().mockResolvedValue(0),
  save: jest.fn(async (value: unknown) => value),
  delete: jest.fn(),
  query: jest.fn(),
});

async function setup() {
  const chats = repo();
  const messages = repo();
  const attachments = repo();
  const module = await Test.createTestingModule({
    providers: [
      ChatService,
      ChatAttachmentsService,
      { provide: getRepositoryToken(Chat), useValue: chats },
      { provide: getRepositoryToken(ChatMessage), useValue: messages },
      { provide: getRepositoryToken(ChatAttachment), useValue: attachments },
      // the real local store on the real uploads directory: these tests check the files on disk
      { provide: FILE_STORE, useValue: new LocalFileStore(UPLOAD_DIR) },
      { provide: ContextService, useValue: { findOwned: jest.fn() } },
      { provide: WorkerService, useValue: { findOwned: jest.fn() } },
      {
        provide: ProviderCredentialsService,
        useValue: { existsFor: jest.fn().mockResolvedValue(true) },
      },
    ],
  }).compile();

  return {
    service: module.get(ChatService),
    attachmentsService: module.get(ChatAttachmentsService),
    chats,
    messages,
    attachments,
  };
}

// A file multer would already have written to disk.
function uploaded(name = 'shot.png', filename = `${Math.random()}.png`) {
  mkdirSync(CHAT_UPLOAD_DIR, { recursive: true });
  writeFileSync(join(CHAT_UPLOAD_DIR, filename), 'bytes');

  return { originalname: name, filename, size: 5 } as Express.Multer.File;
}

const claudeChat = { id: 1, userId: 7, model: ChatModel.Sonnet };

describe('ChatService attachments', () => {
  describe('addAttachment', () => {
    it('stores an unsent attachment for a Claude chat', async () => {
      const { chats, attachments, attachmentsService } = await setup();
      chats.findOne.mockResolvedValue(claudeChat);
      const file = uploaded();

      const saved = await attachmentsService.addAttachment(1, 7, file);

      expect(saved).toMatchObject({
        chatId: 1,
        userId: 7,
        messageId: null,
        originalName: 'shot.png',
        storedName: file.filename,
      });
      expect(attachments.save).toHaveBeenCalledTimes(1);
      expect(existsSync(join(CHAT_UPLOAD_DIR, file.filename))).toBe(true);
    });

    it.each([ChatModel.Opus, ChatModel.Haiku])(
      'stores an attachment for a %s chat too — every Claude model reads files',
      async (model) => {
        const { chats, attachmentsService } = await setup();
        chats.findOne.mockResolvedValue({ ...claudeChat, model });

        await expect(
          attachmentsService.addAttachment(1, 7, uploaded()),
        ).resolves.toMatchObject({ chatId: 1 });
      },
    );

    it.each([ChatModel.Gpt, ChatModel.Deepseek, ChatModel.Qwen])(
      'refuses a %s chat and removes the uploaded file',
      async (model) => {
        const { chats, attachmentsService } = await setup();
        chats.findOne.mockResolvedValue({ ...claudeChat, model });
        const file = uploaded();

        await expect(
          attachmentsService.addAttachment(1, 7, file),
        ).rejects.toThrow('только в чатах с Claude');
        expect(existsSync(join(CHAT_UPLOAD_DIR, file.filename))).toBe(false);
      },
    );

    it('refuses someone else’s chat and removes the file', async () => {
      const { chats, attachmentsService } = await setup();
      chats.findOne.mockResolvedValue(null);
      const file = uploaded();

      await expect(
        attachmentsService.addAttachment(1, 7, file),
      ).rejects.toThrow(NotFoundException);
      expect(existsSync(join(CHAT_UPLOAD_DIR, file.filename))).toBe(false);
    });

    it('refuses a disallowed file type even if the upload filter was bypassed', async () => {
      const { chats, attachmentsService } = await setup();
      chats.findOne.mockResolvedValue(claudeChat);
      const file = uploaded('run.exe', `${Math.random()}.exe`);

      await expect(
        attachmentsService.addAttachment(1, 7, file),
      ).rejects.toThrow(BadRequestException);
      expect(existsSync(join(CHAT_UPLOAD_DIR, file.filename))).toBe(false);
    });

    it('refuses once the chat holds its maximum, and removes the file', async () => {
      const { chats, attachments, attachmentsService } = await setup();
      chats.findOne.mockResolvedValue(claudeChat);
      attachments.count.mockResolvedValue(30);
      const file = uploaded();

      await expect(
        attachmentsService.addAttachment(1, 7, file),
      ).rejects.toThrow('не больше 30');
      expect(existsSync(join(CHAT_UPLOAD_DIR, file.filename))).toBe(false);
    });

    it('removes the file when saving the row fails', async () => {
      const { chats, attachments, attachmentsService } = await setup();
      chats.findOne.mockResolvedValue(claudeChat);
      attachments.save.mockRejectedValue(new Error('db down'));
      const file = uploaded();

      await expect(
        attachmentsService.addAttachment(1, 7, file),
      ).rejects.toThrow('db down');
      expect(existsSync(join(CHAT_UPLOAD_DIR, file.filename))).toBe(false);
    });
  });

  describe('sendMessage with attachments', () => {
    const unsent = (id: number) => ({
      id,
      chatId: 1,
      userId: 7,
      messageId: null,
      originalName: `f${id}.png`,
      storedName: `s${id}.png`,
      size: 5,
    });

    it('links the chosen unsent files to the user message', async () => {
      const { service, chats, messages, attachments } = await setup();
      chats.findOne.mockResolvedValue(claudeChat);
      messages.save.mockImplementation(async (m: object) => ({ id: 50, ...m }));
      attachments.find.mockResolvedValue([unsent(3), unsent(4)]);

      const result = await service.sendMessage(1, 7, 'look', [3, 4]);

      expect(result.attachments.map((a) => a.messageId)).toEqual([50, 50]);
      expect(attachments.save).toHaveBeenCalledWith(result.attachments);
    });

    it('sends a plain message without touching attachments', async () => {
      const { service, chats, messages, attachments } = await setup();
      chats.findOne.mockResolvedValue(claudeChat);
      messages.save.mockImplementation(async (m: object) => ({ id: 50, ...m }));

      const result = await service.sendMessage(1, 7, 'hi');

      expect(result.attachments).toEqual([]);
      expect(attachments.find).not.toHaveBeenCalled();
    });

    it('rejects ids that are not unsent files of this chat and saves no message', async () => {
      const { service, chats, messages, attachments } = await setup();
      chats.findOne.mockResolvedValue(claudeChat);
      attachments.find.mockResolvedValue([unsent(3)]);

      await expect(service.sendMessage(1, 7, 'look', [3, 99])).rejects.toThrow(
        BadRequestException,
      );
      expect(messages.save).not.toHaveBeenCalled();
    });

    it('rejects more than five files in one message', async () => {
      const { service, chats, messages } = await setup();
      chats.findOne.mockResolvedValue(claudeChat);

      await expect(
        service.sendMessage(1, 7, 'x', [1, 2, 3, 4, 5, 6]),
      ).rejects.toThrow('не больше 5');
      expect(messages.save).not.toHaveBeenCalled();
    });
  });

  describe('removing and reading', () => {
    it('takes back an unsent file and deletes it from disk', async () => {
      const { attachments, attachmentsService } = await setup();
      const file = uploaded();
      attachments.findOne.mockResolvedValue({
        id: 3,
        userId: 7,
        messageId: null,
        storedName: file.filename,
      });

      await attachmentsService.removeAttachment(3, 7);

      expect(attachments.delete).toHaveBeenCalledWith(3);
      expect(existsSync(join(CHAT_UPLOAD_DIR, file.filename))).toBe(false);
    });

    it('will not take back a file that is part of a sent message', async () => {
      const { attachments, attachmentsService } = await setup();
      attachments.findOne.mockResolvedValue({
        id: 3,
        userId: 7,
        messageId: 9,
        storedName: 'x.png',
      });

      await expect(attachmentsService.removeAttachment(3, 7)).rejects.toThrow(
        ConflictException,
      );
      expect(attachments.delete).not.toHaveBeenCalled();
    });

    it('scopes reads to the owner', async () => {
      const { attachments, attachmentsService } = await setup();
      attachments.findOne.mockResolvedValue(null);

      await expect(
        attachmentsService.findOwnedAttachment(3, 8),
      ).rejects.toThrow(NotFoundException);
      expect(attachments.findOne).toHaveBeenCalledWith({
        where: { id: 3, userId: 8 },
      });
    });

    it('gives a worker only a file of the chat its message belongs to', async () => {
      const { messages, chats, attachments, attachmentsService } =
        await setup();
      messages.findOne.mockResolvedValue({ id: 20, chatId: 1 });
      chats.findOne.mockResolvedValue(claudeChat);
      attachments.findOne.mockResolvedValue(null);

      await expect(
        attachmentsService.findAttachmentForTurn(20, 3, 7),
      ).rejects.toThrow(NotFoundException);
      expect(attachments.findOne).toHaveBeenCalledWith({
        where: { id: 3, chatId: 1, userId: 7 },
      });
    });
  });

  describe('claim history', () => {
    it('lists each user message’s files in the history the worker receives', async () => {
      const { service, messages, chats, attachments } = await setup();
      messages.query.mockResolvedValue([[{ id: 22 }], 1]);
      messages.findOneByOrFail.mockResolvedValue({
        id: 22,
        chatId: 1,
        role: ChatMessageRole.Assistant,
        status: ChatMessageStatus.Running,
      });
      chats.findOneByOrFail.mockResolvedValue(claudeChat);
      messages.find.mockResolvedValue([
        {
          id: 21,
          role: ChatMessageRole.User,
          content: 'see this',
          status: ChatMessageStatus.Complete,
        },
        {
          id: 22,
          role: ChatMessageRole.Assistant,
          content: '',
          status: ChatMessageStatus.Running,
        },
      ]);
      attachments.find.mockResolvedValue([
        { id: 3, messageId: 21, originalName: 'shot.png', size: 5 },
      ]);

      const claimed = await service.claim(7);

      expect(claimed?.history).toEqual([
        {
          role: ChatMessageRole.User,
          content: 'see this',
          attachments: [{ id: 3, name: 'shot.png', size: 5, isImage: true }],
        },
      ]);
    });
  });

  describe('removeChat', () => {
    it('deletes the chat’s files from disk too', async () => {
      const { service, chats, attachments } = await setup();
      const file = uploaded();
      chats.findOne.mockResolvedValue(claudeChat);
      attachments.find.mockResolvedValue([
        { id: 3, storedName: file.filename },
      ]);

      await service.removeChat(1, 7);

      expect(chats.delete).toHaveBeenCalledWith(1);
      expect(existsSync(join(CHAT_UPLOAD_DIR, file.filename))).toBe(false);
    });
  });

  describe('pruneUnsentAttachments', () => {
    it('drops files uploaded for a message that was never sent', async () => {
      const { attachments, attachmentsService } = await setup();
      const file = uploaded();
      attachments.find.mockResolvedValue([
        { id: 3, storedName: file.filename },
      ]);

      await attachmentsService.pruneUnsentAttachments();

      expect(attachments.delete).toHaveBeenCalled();
      expect(existsSync(join(CHAT_UPLOAD_DIR, file.filename))).toBe(false);
    });

    it('never throws, whatever the database does', async () => {
      const { attachments, attachmentsService } = await setup();
      attachments.find.mockRejectedValue(new Error('db down'));

      await expect(
        attachmentsService.pruneUnsentAttachments(),
      ).resolves.toBeUndefined();
    });
  });
});

describe('ChatService attachmentsByMessage', () => {
  it('makes no query for no messages', async () => {
    const { attachments, attachmentsService } = await setup();

    const result = await attachmentsService.attachmentsByMessage([]);

    expect(result.size).toBe(0);
    expect(attachments.find).not.toHaveBeenCalled();
  });

  it('queries only the given message ids and groups the files per message', async () => {
    const { attachments, attachmentsService } = await setup();
    attachments.find.mockResolvedValue([
      { id: 3, messageId: 21 },
      { id: 4, messageId: 23 },
      { id: 5, messageId: 21 },
    ]);

    const result = await attachmentsService.attachmentsByMessage([21, 22, 23]);

    expect(attachments.find).toHaveBeenCalledWith({
      where: { messageId: In([21, 22, 23]) },
      order: { id: 'ASC' },
    });
    expect(result.get(21)?.map((a) => a.id)).toEqual([3, 5]);
    expect(result.get(22)).toBeUndefined();
    expect(result.get(23)?.map((a) => a.id)).toEqual([4]);
  });

  it('claim() asks only for the completed history messages’ files', async () => {
    const { service, messages, chats, attachments } = await setup();
    messages.query.mockResolvedValue([[{ id: 22 }], 1]);
    messages.findOneByOrFail.mockResolvedValue({
      id: 22,
      chatId: 1,
      role: ChatMessageRole.Assistant,
      status: ChatMessageStatus.Running,
    });
    chats.findOneByOrFail.mockResolvedValue(claudeChat);
    messages.find.mockResolvedValue([
      {
        id: 21,
        role: ChatMessageRole.User,
        content: 'a',
        status: ChatMessageStatus.Complete,
      },
      {
        id: 22,
        role: ChatMessageRole.Assistant,
        content: '',
        status: ChatMessageStatus.Running,
      },
    ]);

    await service.claim(7);

    expect(attachments.find).toHaveBeenCalledWith({
      where: { messageId: In([21]) },
      order: { id: 'ASC' },
    });
  });
});
