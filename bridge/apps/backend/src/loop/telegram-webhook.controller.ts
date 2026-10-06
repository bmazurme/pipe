import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';

import { TelegramService } from '../telegram/telegram.service';
import { LoopService } from './loop.service';
import { safeEqual } from './webhook-signature';

interface TelegramUpdate {
  message?: { text?: string; chat?: { id?: number } };
}

const HELP_TEXT = '/status — последние циклы\n/help — эта справка';

// Inbound half of the Telegram integration. Lives in the loop module (not
// telegram/) because commands act on the loop, and the loop already depends
// on TelegramService for notifications — the other direction would be a
// module cycle. Registered with Telegram via setWebhook(secret_token=...).
@ApiExcludeController()
@Controller('api/v1/telegram')
export class TelegramWebhookController {
  constructor(
    private readonly loopService: LoopService,
    private readonly telegram: TelegramService,
    private readonly configService: ConfigService,
  ) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Headers('x-telegram-bot-api-secret-token') secretToken: string | undefined,
    @Body() update: TelegramUpdate,
  ): Promise<{ ok: true }> {
    const secret = this.configService.get<string>('TELEGRAM_WEBHOOK_SECRET');

    if (!secret) {
      throw new ServiceUnavailableException(
        'TELEGRAM_WEBHOOK_SECRET is not configured',
      );
    }

    if (!safeEqual(secret, secretToken)) {
      throw new UnauthorizedException('Invalid webhook secret');
    }

    const chatId = update.message?.chat?.id;
    const text = update.message?.text;

    // Everyone but the owner chat is ignored silently — and with a 200, so
    // Telegram doesn't keep redelivering the update.
    if (
      chatId === undefined ||
      !text ||
      String(chatId) !== this.telegram.chatId()
    ) {
      return { ok: true };
    }

    // "/status@my_bot" → "/status"
    const command = text.trim().split(/\s+/)[0].split('@')[0].toLowerCase();

    if (command === '/status') {
      await this.telegram.send(await this.loopService.statusText());
    } else if (command === '/help' || command === '/start') {
      await this.telegram.send(HELP_TEXT);
    }

    return { ok: true };
  }
}
