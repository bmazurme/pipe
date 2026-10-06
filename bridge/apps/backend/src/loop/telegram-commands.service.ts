import { Injectable } from '@nestjs/common';

import { TelegramService } from '../telegram/telegram.service';
import { LoopService } from './loop.service';

export interface TelegramUpdate {
  update_id?: number;
  message?: { text?: string; chat?: { id?: number } };
}

const HELP_TEXT = '/status — последние циклы\n/help — эта справка';

// Command handling shared by both ways an update can arrive: the webhook
// controller and the long-polling loop. Lives in the loop module (not
// telegram/) because commands act on the loop, and the loop already depends
// on TelegramService for notifications — the other direction would be a
// module cycle.
@Injectable()
export class TelegramCommandsService {
  constructor(
    private readonly loopService: LoopService,
    private readonly telegram: TelegramService,
  ) {}

  async handle(update: TelegramUpdate): Promise<void> {
    const chatId = update.message?.chat?.id;
    const text = update.message?.text;

    // Everyone but the owner chat is ignored silently.
    if (
      chatId === undefined ||
      !text ||
      String(chatId) !== this.telegram.chatId()
    ) {
      return;
    }

    // "/status@my_bot" → "/status"
    const command = text.trim().split(/\s+/)[0].split('@')[0].toLowerCase();

    if (command === '/status') {
      await this.telegram.send(await this.loopService.statusText());
    } else if (command === '/help' || command === '/start') {
      await this.telegram.send(HELP_TEXT);
    }
  }
}
