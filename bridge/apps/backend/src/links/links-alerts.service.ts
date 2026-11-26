import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { NotifyService } from '../telegram/notify.service';
import { LinkAlert } from './entities/link-alert.entity';
import { type DesiredAlert, desiredAlerts } from './links-alerts';
import { ChannelsView } from './links';

// How sure the chat must be before it is told. Checks come once a minute.
//
// An URGENT condition (the whole pool is gone, the Claude API is out for every worker) is said after CONFIRM_ANNOUNCE checks in a row and
// said to be over after CONFIRM_RECOVER clean ones: nobody should wait for that.
//
// Everything else is judged over a sliding WINDOW of the last checks, because these conditions flicker — a far server answers for a few
// minutes and then does not, one probe times out. It is announced only when it held in at least ANNOUNCE_HITS of the last WINDOW checks, and
// said to be over only when the whole window is clean; a flapping one therefore says nothing at all. After it was said to be over, the same
// condition is not announced again for REANNOUNCE_COOLDOWN_MS (a slow flap would otherwise fill the chat with a pair of messages every
// half hour). Conditions confirmed in the same check go out as ONE message, and so do the ones that ended together.
export const CONFIRM_ANNOUNCE = 2;
export const CONFIRM_RECOVER = 3;
export const WINDOW = 10;
export const ANNOUNCE_HITS = 8;
export const RECOVER_CLEAN = WINDOW;
export const REANNOUNCE_COOLDOWN_MS = 60 * 60_000;

// What an urgent condition is called after a restart forgot which ones were urgent.
const ALWAYS_URGENT = new Set(['none-reachable']);

const alertsOff = () => (process.env.LINK_ALERTS ?? '').toLowerCase() === 'off';

const count = (checks: boolean[]) => checks.filter(Boolean).length;
const lastAll = (checks: boolean[], n: number, value: boolean) =>
  checks.length >= n && checks.slice(-n).every((check) => check === value);

@Injectable()
export class LinksAlertsService {
  private readonly logger = new Logger(LinksAlertsService.name);
  // Per condition: did it hold at each of the last WINDOW checks.
  private readonly history = new Map<string, boolean[]>();
  private readonly urgentKeys = new Set<string>();
  private readonly quietUntil = new Map<string, number>();

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
      const keys = new Set([
        ...desired.keys(),
        ...announced.keys(),
        ...this.history.keys(),
      ]);
      const toAnnounce: DesiredAlert[] = [];
      const toRecover: Array<{ key: string; text: string }> = [];

      for (const key of keys) {
        const checks = [
          ...(this.history.get(key) ?? []),
          desired.has(key),
        ].slice(-WINDOW);

        this.history.set(key, checks);

        const alert = desired.get(key);
        const row = announced.get(key);

        if (alert && !row) {
          const urgent = alert.urgent;
          const confirmed = urgent
            ? lastAll(checks, CONFIRM_ANNOUNCE, true)
            : count(checks) >= ANNOUNCE_HITS &&
              (this.quietUntil.get(key) ?? 0) <= now.getTime();

          if (confirmed) {
            if (urgent) this.urgentKeys.add(key);
            toAnnounce.push(alert);
          }
        } else if (!alert && row) {
          const fast = this.urgentKeys.has(key) || ALWAYS_URGENT.has(key);
          const over = lastAll(
            checks,
            fast ? CONFIRM_RECOVER : RECOVER_CLEAN,
            false,
          );

          if (over) toRecover.push({ key, text: row.recovered });
        }

        if (!alert && !row && !checks.some(Boolean)) this.history.delete(key);
      }

      if (toAnnounce.length > 0) {
        for (const alert of toAnnounce) {
          // Saved first: if sending fails one message is lost, but a failing Telegram cannot turn into a repeat on every check.
          await this.alerts.save({
            key: alert.key,
            since: now,
            recovered: alert.recovered.slice(0, 500),
          });
        }

        await this.notifier?.send(
          toAnnounce.map((alert) => alert.text).join('\n'),
          { urgent: toAnnounce.some((alert) => alert.urgent) },
        );
      }

      if (toRecover.length > 0) {
        for (const { key } of toRecover) {
          await this.alerts.delete({ key });
          this.history.delete(key);

          if (!this.urgentKeys.delete(key) && !ALWAYS_URGENT.has(key)) {
            this.quietUntil.set(key, now.getTime() + REANNOUNCE_COOLDOWN_MS);
          }
        }

        await this.notifier?.send(
          toRecover.map((item) => item.text).join('\n'),
        );
      }
    } catch (error) {
      this.logger.warn(
        `channel alerts failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
