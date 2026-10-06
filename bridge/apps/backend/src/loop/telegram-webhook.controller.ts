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

import {
  TelegramCommandsService,
  TelegramUpdate,
} from './telegram-commands.service';
import { safeEqual } from './webhook-signature';

// Webhook delivery of Telegram updates — an alternative to the long-polling
// loop (TelegramPollerService) for hosts Telegram can reach directly.
// Registered with Telegram via setWebhook(secret_token=...).
@ApiExcludeController()
@Controller('api/v1/telegram')
export class TelegramWebhookController {
  constructor(
    private readonly commands: TelegramCommandsService,
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

    await this.commands.handle(update);

    return { ok: true };
  }
}
