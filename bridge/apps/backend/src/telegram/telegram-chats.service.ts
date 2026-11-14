import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TelegramChat } from './entities/telegram-chat.entity';
import { chatFromUpdate, type ObservedUpdate } from './telegram-chats';

// A busy group would otherwise mean a database write per message.
const REFRESH_MS = 10 * 60_000;

@Injectable()
export class TelegramChatsService {
  private readonly logger = new Logger(TelegramChatsService.name);
  private readonly lastWrite = new Map<string, number>();

  constructor(
    @InjectRepository(TelegramChat)
    private readonly chats: Repository<TelegramChat>,
  ) {}

  // Called for every update the bot receives (both the poller and the webhook go through the command handler). Never throws: learning
  // about a chat must not break handling a command.
  async observe(update: ObservedUpdate): Promise<void> {
    try {
      const seen = chatFromUpdate(update);

      if (!seen) return;

      const now = Date.now();
      const recent = now - (this.lastWrite.get(seen.chatId) ?? 0) < REFRESH_MS;

      // A change of the bot's status (added, promoted, removed) is always written; plain traffic only now and then.
      if (recent && seen.botStatus === null) return;

      this.lastWrite.set(seen.chatId, now);

      const known = await this.chats.findOne({
        where: { chatId: seen.chatId },
      });

      await this.chats.save(
        this.chats.create({
          chatId: seen.chatId,
          type: seen.type,
          title: seen.title ?? known?.title ?? null,
          username: seen.username ?? known?.username ?? null,
          botStatus: seen.botStatus ?? known?.botStatus ?? null,
          lastSeenAt: new Date(),
        }),
      );
    } catch (error) {
      this.logger.warn(`Could not record a chat: ${String(error)}`);
    }
  }

  list(): Promise<TelegramChat[]> {
    return this.chats.find({ order: { lastSeenAt: 'DESC' } });
  }
}
