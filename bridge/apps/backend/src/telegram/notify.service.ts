import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TelegramOutbox } from './entities/telegram-outbox.entity';
import { NotificationSettingsService } from './notification-settings.service';
import { buildDigests, isQuietNow } from './quiet-hours';
import { InlineButton, TelegramService } from './telegram.service';

const FLUSH_EVERY_MS = 60_000;

// Automatic notifications (heartbeats, CI/deploy events, merge offers) go
// through here; replies to something the owner just typed or pressed keep
// using TelegramService directly and are never delayed. The method names
// mirror TelegramService on purpose — a call site only swaps which one it
// holds. During quiet hours (edited on the profile page; until saved there:
// NOTIFY_QUIET_HOURS / NOTIFY_TIMEZONE, default 23:00-08:00 Europe/Moscow, "off"
// disables) a notification is stored instead of sent, and the first flush after
// the window ends delivers them as one digest.
@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);
  private flushing = false;

  constructor(
    private readonly telegram: TelegramService,
    private readonly settings: NotificationSettingsService,
    @InjectRepository(TelegramOutbox)
    private readonly outbox: Repository<TelegramOutbox>,
  ) {}

  async send(text: string): Promise<boolean> {
    if (await this.isQuiet()) {
      return this.enqueue(text, null);
    }

    return this.telegram.send(text);
  }

  async sendWithButtons(
    text: string,
    buttons: InlineButton[][],
  ): Promise<boolean> {
    if (await this.isQuiet()) {
      return this.enqueue(text, buttons);
    }

    return this.telegram.sendWithButtons(text, buttons);
  }

  @Interval(FLUSH_EVERY_MS)
  async flush(): Promise<void> {
    if (
      this.flushing ||
      !this.telegram.isConfigured() ||
      (await this.isQuiet())
    ) {
      return;
    }

    this.flushing = true;

    try {
      const rows = await this.outbox.find({ order: { id: 'ASC' } });

      if (rows.length === 0) {
        return;
      }

      const plain = rows.filter((row) => !row.buttons);
      const withButtons = rows.filter((row) => row.buttons);

      // Rows are deleted only after Telegram accepted them, so an outage
      // leaves the queue intact for the next tick instead of losing it.
      const digests = buildDigests(
        plain,
        (await this.settings.effective()).timezone,
      );
      let delivered = true;

      for (const digest of digests) {
        delivered = (await this.telegram.send(digest)) && delivered;
      }

      if (delivered && plain.length) {
        await this.outbox.delete(plain.map((row) => row.id));
      }

      for (const row of withButtons) {
        const sent = await this.telegram.sendWithButtons(
          `🌙 ${row.text}`,
          JSON.parse(row.buttons as string) as InlineButton[][],
        );

        if (sent) {
          await this.outbox.delete(row.id);
        }
      }
    } catch (error) {
      this.logger.warn(
        `Outbox flush failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.flushing = false;
    }
  }

  private async enqueue(
    text: string,
    buttons: InlineButton[][] | null,
  ): Promise<boolean> {
    if (!this.telegram.isConfigured()) {
      return false;
    }

    try {
      await this.outbox.save({
        text,
        buttons: buttons ? JSON.stringify(buttons) : null,
      });

      return true;
    } catch (error) {
      this.logger.warn(
        `Could not queue a quiet-hours notification: ${error instanceof Error ? error.message : String(error)}`,
      );

      return false;
    }
  }

  private async isQuiet(): Promise<boolean> {
    try {
      const { window, timezone } = await this.settings.effective();

      return isQuietNow(window, timezone);
    } catch (error) {
      // A broken setting must never swallow notifications — fail open.
      this.logger.warn(
        `Quiet-hours settings unreadable, sending normally: ${error instanceof Error ? error.message : String(error)}`,
      );

      return false;
    }
  }
}
