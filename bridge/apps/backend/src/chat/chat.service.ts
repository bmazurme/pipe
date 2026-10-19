import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';

import { isImageAttachment } from './attachments';
import { ChatAttachmentsService } from './chat-attachments.service';
import { ContextService } from '../context/context.service';
import { ClaimedTurnHistoryEntry } from './dto/claimed-turn-response.dto';
import { CreateChatDto } from './dto/create-chat.dto';
import { Chat } from './entities/chat.entity';
import { ChatAttachment } from './entities/chat-attachment.entity';
import {
  ChatMessage,
  ChatMessageRole,
  ChatMessageStatus,
} from './entities/chat-message.entity';
import { MAX_ERROR_MESSAGE_LENGTH, MAX_PROGRESS_LENGTH } from './chat.limits';

// A turn that has been Running longer than this is assumed lost (worker died or the claim response never arrived).
export const STALE_TURN_MS = 30 * 60 * 1000;
export const STALE_TURN_MESSAGE =
  'Воркер не завершил ответ — отправьте сообщение ещё раз';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Chat)
    private readonly chatRepository: Repository<Chat>,
    @InjectRepository(ChatMessage)
    private readonly messageRepository: Repository<ChatMessage>,
    private readonly contextService: ContextService,
    private readonly chatAttachments: ChatAttachmentsService,
  ) {}

  private readonly logger = new Logger(ChatService.name);

  async createChat(userId: number, dto: CreateChatDto): Promise<Chat> {
    // Snapshot, like a Worker job: the chat keeps its own copy of the text.
    const context =
      dto.contextId === undefined || dto.contextId === null
        ? null
        : await this.contextService.findOwned(dto.contextId, userId);

    return this.chatRepository.save({
      userId,
      model: dto.model,
      title: null,
      ...(context
        ? { contextName: context.name, contextText: context.content }
        : {}),
    });
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
    const attachments = await this.chatAttachments.findByChat(chat.id);

    // chat_messages.chatId has an ON DELETE CASCADE FK (see the
    // AddChats migration) — no need to delete messages separately.
    await this.chatRepository.delete(chat.id);
    await Promise.all(
      attachments.map((a) => this.chatAttachments.deleteFile(a)),
    );
  }

  // `updatedAfter` lets a page that already has the thread poll for only what changed since
  // (a new message, or an existing one whose `progress`/`status`/`content` moved) instead of the
  // whole history every second (see chatApi's listMessages) — every write to a message bumps its
  // `updatedAt`, so nothing changed can be missed; messages are never individually deleted (only
  // a whole chat, cascading), so there is no "gone but still cached" case to handle on top of it.
  async listMessages(
    chatId: number,
    userId: number,
    updatedAfter?: Date,
  ): Promise<ChatMessage[]> {
    await this.findOwnedChat(chatId, userId);

    return this.messageRepository.find({
      where: {
        chatId,
        ...(updatedAfter ? { updatedAt: MoreThan(updatedAfter) } : {}),
      },
      order: { createdAt: 'ASC' },
    });
  }

  // Nothing else ever leaves Running except completeTurn/failTurn, so a turn
  // whose worker died would otherwise stay "thinking" forever.
  @Interval(5 * 60 * 1000)
  async failStaleTurns(): Promise<number> {
    try {
      const cutoff = new Date(Date.now() - STALE_TURN_MS);
      const [, count]: [unknown, number] = await this.messageRepository.query(
        `UPDATE chat_messages SET status = $1, "errorMessage" = $2, "updatedAt" = now()
         WHERE status = $3 AND "updatedAt" < $4`,
        [
          ChatMessageStatus.Failed,
          STALE_TURN_MESSAGE,
          ChatMessageStatus.Running,
          cutoff,
        ],
      );

      if (count > 0) this.logger.log(`Failed ${count} stale chat turns`);

      return count;
    } catch (error) {
      this.logger.warn(
        `Stale chat turn sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );

      return 0;
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
    const attachments = await this.chatAttachments.takeUnsent(
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

    await this.chatAttachments.markSent(attachments, userMessage.id);

    // Bumps updatedAt so findAllByUser's "most recently active first" order
    // reflects this chat just having gotten a new message.
    await this.chatRepository.save(chat);

    return { userMessage, assistantMessage, attachments };
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
    const completed = priorMessages.filter(
      (m) => m.status === ChatMessageStatus.Complete,
    );
    const attachments = await this.chatAttachments.attachmentsByMessage(
      completed.map((m) => m.id),
    );

    const history: ClaimedTurnHistoryEntry[] = completed.map((m) => {
      const files = attachments.get(m.id) ?? [];

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

  // What the model has written so far, from the worker, while the turn runs. Only a Running turn takes it (a late report
  // after the turn finished is dropped, not an error to the worker), and it counts as a sign of life for the stale sweep.
  async reportProgress(
    messageId: number,
    userId: number,
    text: string,
  ): Promise<void> {
    const message = await this.findOwnedMessage(messageId, userId);

    if (
      message.role !== ChatMessageRole.Assistant ||
      message.status !== ChatMessageStatus.Running
    ) {
      return;
    }

    await this.messageRepository.update(
      { id: messageId, status: ChatMessageStatus.Running },
      { progress: text.slice(0, MAX_PROGRESS_LENGTH) },
    );
  }

  async completeTurn(
    messageId: number,
    userId: number,
    content: string,
  ): Promise<ChatMessage> {
    const message = await this.findRunningAssistantMessage(messageId, userId);

    message.content = content;
    message.progress = null;
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
    message.errorMessage =
      errorMessage === undefined
        ? null
        : errorMessage.slice(-MAX_ERROR_MESSAGE_LENGTH);
    message.progress = null;

    return this.messageRepository.save(message);
  }
}
