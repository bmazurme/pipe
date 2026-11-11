import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { NotifyService } from '../telegram/notify.service';
import { LinkAlert } from './entities/link-alert.entity';
import { desiredAlerts } from './links-alerts';
import { ChannelsView } from './links';

// A condition must hold this many checks in a row (one a minute) before it is announced, and be gone this many before it is announced as
// over: a channel that flaps, or one probe that happened to time out, must not fill the chat.
export const CONFIRM_ANNOUNCE = 2;
export const CONFIRM_RECOVER = 3;

const alertsOff = () => (process.env.LINK_ALERTS ?? '').toLowerCase() === 'off';

@Injectable()
export class LinksAlertsService {
  private readonly logger = new Logger(LinksAlertsService.name);
  private readonly holding = new Map<string, number>();
  private readonly gone = new Map<string, number>();

  constructor(
    @InjectRepository(LinkAlert)
    private readonly alerts: Repository<LinkAlert>,
    @Optional() private readonly notifier?: NotifyService,
  ) {}

  // One check: compare what holds now with what was announced. Never throws — a failing alert must not stop the probing.
  async evaluate(view: ChannelsView, now = new Date()): Promise<void> {
    if (alertsOff()) return;

    try {
      const desired = new Map(
        desiredAlerts(view).map((alert) => [alert.key, alert]),
      );
      const announced = new Map(
        (await this.alerts.find()).map((row) => [row.key, row]),
      );

      for (const key of [...this.holding.keys()])
        if (!desired.has(key)) this.holding.delete(key);
      for (const key of [...this.gone.keys()])
        if (desired.has(key) || !announced.has(key)) this.gone.delete(key);

      for (const [key, alert] of desired) {
        this.gone.delete(key);

        if (announced.has(key)) continue;

        const streak = (this.holding.get(key) ?? 0) + 1;

        this.holding.set(key, streak);

        if (streak >= CONFIRM_ANNOUNCE) {
          // Saved first: if sending fails one message is lost, but a failing Telegram cannot turn into a repeat on every check.
          await this.alerts.save({
            key,
            since: now,
            recovered: alert.recovered.slice(0, 500),
          });
          await this.notifier?.send(alert.text, { urgent: alert.urgent });
          this.holding.delete(key);
        }
      }

      for (const [key, row] of announced) {
        if (desired.has(key)) continue;

        const streak = (this.gone.get(key) ?? 0) + 1;

        this.gone.set(key, streak);

        if (streak >= CONFIRM_RECOVER) {
          await this.alerts.delete({ key });
          await this.notifier?.send(row.recovered);
          this.gone.delete(key);
        }
      }
    } catch (error) {
      this.logger.warn(
        `channel alerts failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
