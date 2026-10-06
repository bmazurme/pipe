import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TelegramService } from '../telegram/telegram.service';
import {
  TelegramCommandsService,
  TelegramUpdate,
} from './telegram-commands.service';

const LONG_POLL_SECONDS = 25;
// Must outlast the long poll itself, or every idle poll would be aborted.
const POLL_REQUEST_TIMEOUT_MS = (LONG_POLL_SECONDS + 10) * 1000;
const MIN_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 60_000;

// Receives updates by long polling (getUpdates) instead of a webhook: the
// production host can reach Telegram only through the VPN proxy and Telegram
// can't reach it at all, so outbound-only is the one mode that works — the
// same shape as worker, which only ever polls bridge. Opt-in
// (TELEGRAM_POLLING=true): a developer's local backend sharing the prod bot
// token would otherwise steal the prod instance's updates (Telegram allows
// one getUpdates consumer per bot).
@Injectable()
export class TelegramPollerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(TelegramPollerService.name);
  private offset = 0;
  private stopped = false;

  constructor(
    private readonly telegram: TelegramService,
    private readonly commands: TelegramCommandsService,
    private readonly configService: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (
      this.configService.get<string>('TELEGRAM_POLLING') !== 'true' ||
      !this.telegram.isConfigured()
    ) {
      return;
    }

    void this.run();
  }

  onModuleDestroy(): void {
    this.stopped = true;
  }

  // One getUpdates round. Returns the number of updates handled, or null when
  // the call failed — separated from the loop so it is testable without
  // timers.
  async pollOnce(): Promise<number | null> {
    const updates = await this.telegram.api<TelegramUpdate[]>(
      'getUpdates',
      {
        offset: this.offset,
        timeout: LONG_POLL_SECONDS,
        allowed_updates: ['message'],
      },
      POLL_REQUEST_TIMEOUT_MS,
    );

    if (!Array.isArray(updates)) {
      return null;
    }

    for (const update of updates) {
      // Advance first: a command that throws must not be redelivered forever.
      if (update.update_id !== undefined) {
        this.offset = update.update_id + 1;
      }

      try {
        await this.commands.handle(update);
      } catch (error) {
        this.logger.warn(
          `Telegram command failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return updates.length;
  }

  private async run(): Promise<void> {
    // getUpdates is rejected (409) while a webhook is registered.
    await this.telegram.api('deleteWebhook', {});
    this.logger.log('Telegram long polling started');

    let backoff = MIN_BACKOFF_MS;

    while (!this.stopped) {
      if ((await this.pollOnce()) === null) {
        await new Promise((resolve) => setTimeout(resolve, backoff));
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      } else {
        backoff = MIN_BACKOFF_MS;
      }
    }
  }
}
