import { Injectable, Logger } from '@nestjs/common';

import { ChatService } from '../chat/chat.service';
import { ChatModel } from '../chat/entities/chat.entity';
import {
  ChatMessageRole,
  ChatMessageStatus,
} from '../chat/entities/chat-message.entity';
import { classifierPrompt, parseClassification } from './router-classifier';
import type { Classification } from './router-policy';

// How long a run waits for the answer before it goes on with the fallback model: the question is a few seconds of Haiku, so a
// longer wait means no worker with Claude is there to ask.
export const CLASSIFY_TIMEOUT_MS = 60_000;
const POLL_MS = 1_000;

// Asks Haiku how big a task is. There is no key for the Claude API in bridge (only the tokens workers use), so the question goes the way a
// chat turn does: a chat of its own, claimed by a worker, answered, read, and deleted again.
@Injectable()
export class RouterClassifierService {
  private readonly logger = new Logger(RouterClassifierService.name);

  constructor(private readonly chats: ChatService) {}

  async classify(
    userId: number,
    task: { title: string; body: string },
    options: { timeoutMs?: number; pollMs?: number } = {},
  ): Promise<Classification | null> {
    const timeoutMs = options.timeoutMs ?? CLASSIFY_TIMEOUT_MS;
    const pollMs = options.pollMs ?? POLL_MS;
    let chatId: number | null = null;

    try {
      const chat = await this.chats.createChat(userId, {
        model: ChatModel.Haiku,
      });

      chatId = chat.id;
      await this.chats.renameChat(
        chat.id,
        userId,
        'Маршрутизатор: оценка размера задачи',
      );

      const { assistantMessage } = await this.chats.sendMessage(
        chat.id,
        userId,
        classifierPrompt(task),
      );
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        const messages = await this.chats.listMessages(chat.id, userId);
        const answer = messages.find(
          (message) =>
            message.id === assistantMessage.id &&
            message.role === ChatMessageRole.Assistant,
        );

        if (answer?.status === ChatMessageStatus.Complete)
          return parseClassification(answer.content);
        if (answer?.status === ChatMessageStatus.Failed) return null;

        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }

      return null;
    } catch (error) {
      this.logger.warn(
        `Could not classify a task: ${error instanceof Error ? error.message : String(error)}`,
      );

      return null;
    } finally {
      if (chatId !== null)
        await this.chats.removeChat(chatId, userId).catch(() => undefined);
    }
  }
}
