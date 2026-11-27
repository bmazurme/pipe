import { Injectable, Logger, Optional } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AlertFallbackService } from './alert-fallback.service';
import { AlertGate, buildBurstMessage } from './alert-budget';
import { TelegramOutbox } from './entities/telegram-outbox.entity';
import { NotificationSettingsService } from './notification-settings.service';
import { NotifyStatsService } from './notify-stats.service';
import { buildDigests, formatLocalTime, isQuietNow } from './quiet-hours';
import { InlineButton, TelegramService } from './telegram.service';

const FLUSH_EVERY_MS = 60_000;
// A message held back from a burst waits at least this long, so the ones that follow join the same group message.
const BURST_HOLD_MS = 45_000;

export interface NotifyOptions {
  // Delivered even while it is quiet (if the owner allows it): something broke that cannot wait for the morning digest.
  urgent?: boolean;
}

// Automatic notifications (heartbeats, CI/deploy events, merge offers) go
// through here; replies to something the owner just typed or pressed keep
// using TelegramService directly and are never delayed. The method names
// mirror TelegramService on purpose — a call site only swaps which one it
// holds. During quiet hours (edited on the profile page; until saved there:
// NOTIFY_QUIET_HOURS / NOTIFY_TIMEZONE, default 23:00-08:00 Europe/Moscow, "off"
// disables) a notification is stored instead of sent, and the first flush after
// the window ends delivers them as one digest.
//
// R6, the alert budget (alert-budget.ts): before anything leaves, the same text again within the hour is not said again, and a burst of ordinary
// messages is held and goes out as one grouped message; the daily counts (what left, what did not, who is noisy) are kept for the Dashboard.
@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);
  private flushing = false;
  private readonly gate = new AlertGate();

  constructor(
    private readonly telegram: TelegramService,
    private readonly settings: NotificationSettingsService,
    @InjectRepository(TelegramOutbox)
    private readonly outbox: Repository<TelegramOutbox>,
    @Optional() private readonly fallback?: AlertFallbackService,
    @Optional() private readonly stats?: NotifyStatsService,
  ) {}

  async send(text: string, options: NotifyOptions = {}): Promise<boolean> {
    const now = Date.now();
    const urgent = options.urgent === true;

    this.track(this.stats?.attempt(text));

    // The same text again: nothing to add. Answered `true` — the owner knows, and a caller that retries on `false` must not.
    const decision = this.gate.decide(text, urgent, now);

    if (decision === 'dedupe') {
      this.track(this.stats?.count('deduped'));

      return true;
    }

    if (await this.isQuiet(options)) {
      this.gate.remember(text, now);
      this.track(this.stats?.count('quiet'));

      return this.enqueue(text, null);
    }

    // A burst: this one waits for the group message (urgent never does).
    if (decision === 'hold') {
      this.gate.remember(text, now);
      this.track(this.stats?.count('grouped'));

      return this.enqueue(text, null, 'burst');
    }

    const sent = this.deliver(await this.telegram.send(text), text, options);

    if (sent) {
      this.gate.remember(text, now);
      if (!urgent) this.gate.recordSent(now);
      this.track(this.stats?.count(urgent ? 'urgent' : 'sent'));
    }

    return sent;
  }

  // What Telegram did not carry and cannot wait is also handed to the other way out (a webhook, e-mail), when one is set up: the point
  // of an urgent notification is that the owner learns of it, whatever is wrong with Telegram.
  private deliver(
    sent: boolean,
    text: string,
    options: NotifyOptions,
  ): boolean {
    if (!sent && options.urgent) this.fallback?.mirror(text);

    return sent;
  }

  async sendWithButtons(
    text: string,
    buttons: InlineButton[][],
    options: NotifyOptions = {},
  ): Promise<boolean> {
    this.track(this.stats?.attempt(text));

    if (await this.isQuiet(options)) {
      this.track(this.stats?.count('quiet'));

      return this.enqueue(text, buttons);
    }

    // A message with buttons is an offer somebody has to act on: never deduplicated or held, but it counts toward the budget and the burst.
    const sent = this.deliver(
      await this.telegram.sendWithButtons(text, buttons),
      text,
      options,
    );

    if (sent) {
      if (options.urgent !== true) this.gate.recordSent(Date.now());
      this.track(
        this.stats?.count(options.urgent === true ? 'urgent' : 'sent'),
      );
    }

    return sent;
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

      const burst = rows.filter((row) => row.kind === 'burst');
      const held = rows.filter((row) => row.kind !== 'burst');
      const plain = held.filter((row) => !row.buttons);
      const withButtons = held.filter((row) => row.buttons);
      const { timezone } = await this.settings.effective();

      // The held-back messages of a burst, as ONE message — once the burst has had time to finish (the oldest has waited BURST_HOLD_MS).
      const ready =
        burst.length > 0 &&
        Date.now() - burst[0].createdAt.getTime() >= BURST_HOLD_MS;

      if (ready) {
        const text = buildBurstMessage(
          burst.map((row) => ({
            text: row.text,
            time: formatLocalTime(row.createdAt, timezone),
          })),
        );

        if (await this.telegram.send(text)) {
          await this.outbox.delete(burst.map((row) => row.id));
          this.track(this.stats?.count('sent'));
        }
      }

      // Rows are deleted only after Telegram accepted them, so an outage
      // leaves the queue intact for the next tick instead of losing it.
      const digests = buildDigests(plain, timezone);
      let delivered = true;

      for (const digest of digests) {
        delivered = (await this.telegram.send(digest)) && delivered;
      }

      if (delivered && plain.length) {
        await this.outbox.delete(plain.map((row) => row.id));
        this.track(this.stats?.count('sent', digests.length));
      }

      for (const row of withButtons) {
        const sent = await this.telegram.sendWithButtons(
          `🌙 ${row.text}`,
          JSON.parse(row.buttons as string) as InlineButton[][],
        );

        if (sent) {
          await this.outbox.delete(row.id);
          this.track(this.stats?.count('sent'));
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
    kind: 'quiet' | 'burst' = 'quiet',
  ): Promise<boolean> {
    if (!this.telegram.isConfigured()) {
      return false;
    }

    try {
      await this.outbox.save({
        text,
        buttons: buttons ? JSON.stringify(buttons) : null,
        kind,
      });

      return true;
    } catch (error) {
      this.logger.warn(
        `Could not queue a quiet-hours notification: ${error instanceof Error ? error.message : String(error)}`,
      );

      return false;
    }
  }

  // The statistics never delay, fail or crash a notification: their own errors are theirs.
  private track(pending: Promise<void> | undefined): void {
    pending?.catch(() => undefined);
  }

  private async isQuiet(options: NotifyOptions = {}): Promise<boolean> {
    try {
      const { window, timezone, quietWeekends, allowUrgent } =
        await this.settings.effective();

      if (options.urgent && allowUrgent) {
        return false;
      }

      return isQuietNow(window, timezone, new Date(), quietWeekends);
    } catch (error) {
      // A broken setting must never swallow notifications — fail open.
      this.logger.warn(
        `Quiet-hours settings unreadable, sending normally: ${error instanceof Error ? error.message : String(error)}`,
      );

      return false;
    }
  }
}
