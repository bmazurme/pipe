import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ClaimedTurnHistoryEntry } from './dto/claimed-turn-response.dto';
import { CreateChatDto } from './dto/create-chat.dto';
import { Chat } from './entities/chat.entity';
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
  ) {}

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
    // chat_messages.chatId has an ON DELETE CASCADE FK (see the
    // AddChats migration) — no need to delete messages separately.
    await this.chatRepository.delete(chat.id);
  }

  async listMessages(chatId: number, userId: number): Promise<ChatMessage[]> {
    await this.findOwnedChat(chatId, userId);

    return this.messageRepository.find({
      where: { chatId },
      order: { createdAt: 'ASC' },
    });
  }

  // Saves the user's message and its paired pending assistant reply in one
  // call — this is what lets the frontend show a "thinking" state
  // immediately, without a second round trip to create the placeholder.
  async sendMessage(
    chatId: number,
    userId: number,
    content: string,
  ): Promise<{ userMessage: ChatMessage; assistantMessage: ChatMessage }> {
    const chat = await this.findOwnedChat(chatId, userId);

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

    // Bumps updatedAt so findAllByUser's "most recently active first" order
    // reflects this chat just having gotten a new message.
    await this.chatRepository.save(chat);

    return { userMessage, assistantMessage };
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
    const history: ClaimedTurnHistoryEntry[] = priorMessages
      .filter((m) => m.status === ChatMessageStatus.Complete)
      .map((m) => ({ role: m.role, content: m.content }));

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

  // A late or duplicate report must not overwrite a turn that already
  // finished — only a Running message can be completed or failed.
  private assertRunning(message: ChatMessage): void {
    if (message.status !== ChatMessageStatus.Running) {
      throw new ConflictException('Message is not running');
    }
  }

  async completeTurn(
    messageId: number,
    userId: number,
    content: string,
  ): Promise<ChatMessage> {
    const message = await this.findOwnedMessage(messageId, userId);
    this.assertRunning(message);

    message.content = content;
    message.status = ChatMessageStatus.Complete;

    return this.messageRepository.save(message);
  }

  async failTurn(
    messageId: number,
    userId: number,
    errorMessage?: string,
  ): Promise<ChatMessage> {
    const message = await this.findOwnedMessage(messageId, userId);
    this.assertRunning(message);

    message.status = ChatMessageStatus.Failed;
    message.errorMessage = errorMessage ?? null;

    return this.messageRepository.save(message);
  }
}
