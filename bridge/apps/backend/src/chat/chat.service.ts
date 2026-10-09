import { unlink } from 'fs/promises';
import { join } from 'path';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Repository } from 'typeorm';

import {
  isAllowedAttachment,
  isImageAttachment,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_CHAT,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from './attachments';
import { CHAT_UPLOAD_DIR } from './config/attachment-multer.config';
import { ClaimedTurnHistoryEntry } from './dto/claimed-turn-response.dto';
import { CreateChatDto } from './dto/create-chat.dto';
import { Chat, ChatModel } from './entities/chat.entity';
import { ChatAttachment } from './entities/chat-attachment.entity';
import {
  ChatMessage,
  ChatMessageRole,
  ChatMessageStatus,
} from './entities/chat-message.entity';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Chat)
    private readonly chatRepository: Repository<Chat>,
    @InjectRepository(ChatMessage)
    private readonly messageRepository: Repository<ChatMessage>,
    @InjectRepository(ChatAttachment)
    private readonly attachmentRepository: Repository<ChatAttachment>,
  ) {}

  private readonly logger = new Logger(ChatService.name);

  async createChat(userId: number, dto: CreateChatDto): Promise<Chat> {
    return this.chatRepository.save({ userId, model: dto.model, title: null });
  }

  async findAllByUser(userId: number): Promise<Chat[]> {
    return this.chatRepository.find({
      where: { userId },
      order: { updatedAt: 'DESC' },
    });
  }

  async findOwnedChat(id: number, userId: number): Promise<Chat> {
    const chat = await this.chatRepository.findOne({ where: { id, userId } });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    return chat;
  }

  async renameChat(id: number, userId: number, title: string): Promise<Chat> {
    const chat = await this.findOwnedChat(id, userId);
    chat.title = title;
    return this.chatRepository.save(chat);
  }

  async removeChat(id: number, userId: number): Promise<void> {
    const chat = await this.findOwnedChat(id, userId);
    // The rows go with the chat (ON DELETE CASCADE), the files on disk do not.
    const attachments = await this.attachmentRepository.find({
      where: { chatId: chat.id },
    });

    // chat_messages.chatId has an ON DELETE CASCADE FK (see the
    // AddChats migration) — no need to delete messages separately.
    await this.chatRepository.delete(chat.id);
    await Promise.all(attachments.map((a) => this.deleteFile(a)));
  }

  async listMessages(chatId: number, userId: number): Promise<ChatMessage[]> {
    await this.findOwnedChat(chatId, userId);

    return this.messageRepository.find({
      where: { chatId },
      order: { createdAt: 'ASC' },
    });
  }

  // ------------------------------------------------------------ attachments

  private async deleteFile(attachment: ChatAttachment): Promise<void> {
    try {
      await unlink(join(CHAT_UPLOAD_DIR, attachment.storedName));
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
    const discard = async (reason: BadRequestException) => {
      await unlink(join(CHAT_UPLOAD_DIR, file.filename)).catch(() => undefined);
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
      await unlink(join(CHAT_UPLOAD_DIR, file.filename)).catch(() => undefined);
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

  attachmentPath(attachment: ChatAttachment): string {
    return join(CHAT_UPLOAD_DIR, attachment.storedName);
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

  listAttachments(chatId: number): Promise<ChatAttachment[]> {
    return this.attachmentRepository.find({
      where: { chatId },
      order: { id: 'ASC' },
    });
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

  // Saves the user's message and its paired pending assistant reply in one
  // call — this is what lets the frontend show a "thinking" state
  // immediately, without a second round trip to create the placeholder.
  async sendMessage(
    chatId: number,
    userId: number,
    content: string,
    attachmentIds: number[] = [],
  ): Promise<{
    userMessage: ChatMessage;
    assistantMessage: ChatMessage;
    attachments: ChatAttachment[];
  }> {
    const chat = await this.findOwnedChat(chatId, userId);

    // Checked before anything is saved, so a bad id never leaves a message behind.
    const attachments = await this.takeUnsentAttachments(
      chatId,
      userId,
      attachmentIds,
    );

    const userMessage = await this.messageRepository.save({
      chatId,
      role: ChatMessageRole.User,
      content,
      status: ChatMessageStatus.Complete,
    });

    const assistantMessage = await this.messageRepository.save({
      chatId,
      role: ChatMessageRole.Assistant,
      content: '',
      status: ChatMessageStatus.Pending,
    });

    for (const attachment of attachments) {
      attachment.messageId = userMessage.id;
    }
    if (attachments.length > 0) {
      await this.attachmentRepository.save(attachments);
    }

    // Bumps updatedAt so findAllByUser's "most recently active first" order
    // reflects this chat just having gotten a new message.
    await this.chatRepository.save(chat);

    return { userMessage, assistantMessage, attachments };
  }

  private async takeUnsentAttachments(
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

  // Atomically takes the oldest pending assistant message across all of
  // this account's chats — same FOR UPDATE SKIP LOCKED pattern as
  // WorkerService.claim, so two worker processes never claim the same turn.
  async claim(userId: number): Promise<{
    message: ChatMessage;
    chat: Chat;
    history: ClaimedTurnHistoryEntry[];
  } | null> {
    // node-postgres's driver (via TypeORM's Repository.query) returns
    // [rows, affectedCount] for an UPDATE/INSERT/DELETE — even one with a
    // RETURNING clause — not a flat rows array the way a plain SELECT does.
    // Indexing straight into the result ([0]?.id) silently reads the rows
    // array itself as if it were the first row, always finding no `.id` and
    // reporting "nothing to claim" even though the UPDATE just committed.
    const [rows]: [{ id: number }[], number] =
      await this.messageRepository.query(
        `UPDATE chat_messages SET status = $1, "updatedAt" = now()
       WHERE id = (
         SELECT cm.id FROM chat_messages cm
         INNER JOIN chats c ON c.id = cm."chatId"
         WHERE cm.status = $2 AND c."userId" = $3
         ORDER BY cm."createdAt" ASC LIMIT 1 FOR UPDATE OF cm SKIP LOCKED
       )
       RETURNING id`,
        [ChatMessageStatus.Running, ChatMessageStatus.Pending, userId],
      );

    const claimedId = rows[0]?.id;
    if (claimedId === undefined) return null;

    const message = await this.messageRepository.findOneByOrFail({
      id: claimedId,
    });
    const chat = await this.chatRepository.findOneByOrFail({
      id: message.chatId,
    });

    const priorMessages = await this.messageRepository.find({
      where: { chatId: message.chatId },
      order: { createdAt: 'ASC' },
    });

    // Only Complete messages: the claimed message is Running, and
    // Pending/Failed assistant placeholders have empty content, which
    // providers such as Anthropic reject.
    const attachments = await this.listAttachments(message.chatId);

    const history: ClaimedTurnHistoryEntry[] = priorMessages
      .filter((m) => m.status === ChatMessageStatus.Complete)
      .map((m) => {
        const files = attachments.filter((a) => a.messageId === m.id);

        return {
          role: m.role,
          content: m.content,
          ...(files.length > 0
            ? {
                attachments: files.map((a) => ({
                  id: a.id,
                  name: a.originalName,
                  size: a.size,
                  isImage: isImageAttachment(a.originalName),
                })),
              }
            : {}),
        };
      });

    return { message, chat, history };
  }

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

    await this.findOwnedChat(message.chatId, userId);

    return message;
  }

  // claim() is the only place that sets Running, so a turn report is only
  // valid for an assistant message in that state — anything else is a wrong
  // id (a user message) or a late/duplicate report for a finished turn.
  private async findRunningAssistantMessage(
    messageId: number,
    userId: number,
  ): Promise<ChatMessage> {
    const message = await this.findOwnedMessage(messageId, userId);

    if (message.role !== ChatMessageRole.Assistant) {
      throw new BadRequestException('Message is not an assistant message');
    }
    if (message.status !== ChatMessageStatus.Running) {
      throw new ConflictException('Message is not awaiting a turn result');
    }

    return message;
  }

  async completeTurn(
    messageId: number,
    userId: number,
    content: string,
  ): Promise<ChatMessage> {
    const message = await this.findRunningAssistantMessage(messageId, userId);

    message.content = content;
    message.status = ChatMessageStatus.Complete;

    return this.messageRepository.save(message);
  }

  async failTurn(
    messageId: number,
    userId: number,
    errorMessage?: string,
  ): Promise<ChatMessage> {
    const message = await this.findRunningAssistantMessage(messageId, userId);

    message.status = ChatMessageStatus.Failed;
    message.errorMessage = errorMessage ?? null;

    return this.messageRepository.save(message);
  }
}
