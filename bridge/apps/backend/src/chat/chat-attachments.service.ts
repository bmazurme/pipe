import { unlink } from 'fs/promises';
import { join } from 'path';
import type { Response } from 'express';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Repository } from 'typeorm';

import {
  isAllowedAttachment,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_CHAT,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from './attachments';
import { FILE_STORE, type FileStore } from '../storage/file-store/file-store';
import {
  type SendDone,
  sendStoredFile,
} from '../storage/file-store/send-stored-file';
import { CHAT_UPLOAD_DIR } from './config/attachment-multer.config';
import { Chat, ChatModel } from './entities/chat.entity';
import { ChatAttachment } from './entities/chat-attachment.entity';
import { ChatMessage } from './entities/chat-message.entity';

// Chat attachments live under chat/ in the store (apart from Storage's mailbox, see attachment-multer.config.ts).
const chatKey = (storedName: string) => `chat/${storedName}`;

@Injectable()
export class ChatAttachmentsService {
  constructor(
    @InjectRepository(Chat)
    private readonly chatRepository: Repository<Chat>,
    @InjectRepository(ChatMessage)
    private readonly messageRepository: Repository<ChatMessage>,
    @InjectRepository(ChatAttachment)
    private readonly attachmentRepository: Repository<ChatAttachment>,
    @Inject(FILE_STORE) private readonly store: FileStore,
  ) {}

  private readonly logger = new Logger(ChatAttachmentsService.name);

  // The message must belong to one of the user's chats.
  private async findOwnedMessage(
    messageId: number,
    userId: number,
  ): Promise<ChatMessage> {
    const message = await this.messageRepository.findOne({
      where: { id: messageId },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    const chat = await this.chatRepository.findOne({
      where: { id: message.chatId, userId },
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    return message;
  }

  async findByChat(chatId: number): Promise<ChatAttachment[]> {
    return this.attachmentRepository.find({ where: { chatId } });
  }

  // Links files taken with takeUnsent to the message that was just saved.
  async markSent(
    attachments: ChatAttachment[],
    messageId: number,
  ): Promise<void> {
    if (attachments.length === 0) return;

    for (const attachment of attachments) {
      attachment.messageId = messageId;
    }
    await this.attachmentRepository.save(attachments);
  }

  async deleteFile(attachment: ChatAttachment): Promise<void> {
    try {
      await this.store.remove(chatKey(attachment.storedName));
    } catch (error) {
      this.logger.warn(
        `Could not remove chat attachment file ${attachment.storedName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // The file multer already wrote to disk. Anything refused here must remove it again.
  async addAttachment(
    chatId: number,
    userId: number,
    file: Express.Multer.File,
  ): Promise<ChatAttachment> {
    // Refused before the file reached its final place: only the staged copy exists.
    const staged = file.path ?? join(CHAT_UPLOAD_DIR, file.filename);
    const discard = async (reason: BadRequestException) => {
      await unlink(staged).catch(() => undefined);
      throw reason;
    };

    const chat = await this.chatRepository.findOne({
      where: { id: chatId, userId },
    });

    if (!chat) {
      return discard(new NotFoundException('Chat not found'));
    }

    if (chat.model !== ChatModel.Sonnet && chat.model !== ChatModel.Opus) {
      return discard(
        new BadRequestException(
          'Вложения поддерживаются только в чатах с Claude (Sonnet или Opus)',
        ),
      );
    }

    if (!isAllowedAttachment(file.originalname)) {
      return discard(
        new BadRequestException('Этот тип файла нельзя прикрепить'),
      );
    }

    if (file.size > MAX_ATTACHMENT_BYTES) {
      return discard(new BadRequestException('Файл слишком большой'));
    }

    const existing = await this.attachmentRepository.count({
      where: { chatId },
    });

    if (existing >= MAX_ATTACHMENTS_PER_CHAT) {
      return discard(
        new BadRequestException(
          `В одном чате можно хранить не больше ${MAX_ATTACHMENTS_PER_CHAT} вложений — начните новый чат`,
        ),
      );
    }

    // Moved to wherever files live (nothing to do for the local driver); an upload that fails removes the
    // staged copy itself, and a row that cannot be saved removes the stored file again.
    await this.store.adopt(chatKey(file.filename), staged);

    try {
      return await this.attachmentRepository.save({
        chatId,
        userId,
        messageId: null,
        originalName: file.originalname,
        storedName: file.filename,
        size: file.size,
      });
    } catch (error) {
      await this.store.remove(chatKey(file.filename)).catch(() => undefined);
      throw error;
    }
  }

  async findOwnedAttachment(
    id: number,
    userId: number,
  ): Promise<ChatAttachment> {
    const attachment = await this.attachmentRepository.findOne({
      where: { id, userId },
    });

    if (!attachment) {
      throw new NotFoundException('Attachment not found');
    }

    return attachment;
  }

  // The worker reads a turn's files through this: it must be a file of the chat that
  // message belongs to, never an id from somewhere else.
  async findAttachmentForTurn(
    messageId: number,
    attachmentId: number,
    userId: number,
  ): Promise<ChatAttachment> {
    const message = await this.findOwnedMessage(messageId, userId);
    const attachment = await this.attachmentRepository.findOne({
      where: { id: attachmentId, chatId: message.chatId, userId },
    });

    if (!attachment) {
      throw new NotFoundException('Attachment not found');
    }

    return attachment;
  }

  // Sends an attachment's bytes where it is (the caller has set the headers); `done` reports the outcome once.
  sendAttachment(
    res: Response,
    attachment: ChatAttachment,
    done: SendDone,
  ): void {
    sendStoredFile(
      this.store,
      res,
      chatKey(attachment.storedName),
      { kind: 'inline' },
      done,
    );
  }

  // Only a file that has not been sent yet can be taken back; one in a sent message is
  // part of the conversation.
  async removeAttachment(id: number, userId: number): Promise<void> {
    const attachment = await this.findOwnedAttachment(id, userId);

    if (attachment.messageId !== null) {
      throw new ConflictException('Файл уже отправлен в сообщении');
    }

    await this.attachmentRepository.delete(attachment.id);
    await this.deleteFile(attachment);
  }

  // Attachments of just these messages, grouped by message: no query at all for none
  // (an empty poll delta), and never a scan of the whole chat.
  async attachmentsByMessage(
    messageIds: number[],
  ): Promise<Map<number, ChatAttachment[]>> {
    const byMessage = new Map<number, ChatAttachment[]>();
    if (messageIds.length === 0) return byMessage;

    const attachments = await this.attachmentRepository.find({
      where: { messageId: In(messageIds) },
      order: { id: 'ASC' },
    });
    for (const attachment of attachments) {
      if (attachment.messageId === null) continue;
      const list = byMessage.get(attachment.messageId);
      if (list) list.push(attachment);
      else byMessage.set(attachment.messageId, [attachment]);
    }

    return byMessage;
  }

  // Files uploaded for a message that was never sent are dropped after a day.
  @Cron(CronExpression.EVERY_HOUR)
  async pruneUnsentAttachments(): Promise<void> {
    try {
      const stale = await this.attachmentRepository.find({
        where: {
          messageId: IsNull(),
          createdAt: LessThan(new Date(Date.now() - 24 * 60 * 60 * 1000)),
        },
      });

      if (stale.length === 0) return;

      await this.attachmentRepository.delete({
        id: In(stale.map((a) => a.id)),
      });
      await Promise.all(stale.map((a) => this.deleteFile(a)));
      this.logger.log(`Pruned ${stale.length} unsent chat attachments`);
    } catch (error) {
      this.logger.warn(
        `Chat attachment prune failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async takeUnsent(
    chatId: number,
    userId: number,
    ids: number[],
  ): Promise<ChatAttachment[]> {
    const unique = [...new Set(ids)];

    if (unique.length === 0) return [];

    if (unique.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      throw new BadRequestException(
        `К сообщению можно прикрепить не больше ${MAX_ATTACHMENTS_PER_MESSAGE} файлов`,
      );
    }

    const found = await this.attachmentRepository.find({
      where: { id: In(unique), chatId, userId, messageId: IsNull() },
    });

    if (found.length !== unique.length) {
      throw new BadRequestException(
        'Часть файлов не найдена или уже отправлена — загрузите их заново',
      );
    }

    return found;
  }
}
