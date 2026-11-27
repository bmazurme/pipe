import { Injectable, Logger, Optional } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { AppService } from '../app.service';
import { NotifyService } from '../telegram/notify.service';

const PING_EVERY_MS = 60_000;
const PING_TIMEOUT_MS = 10_000;
// This many failed pings in a row (about ten minutes): the watcher is probably not getting them either — say so, once.
export const ALERT_AFTER_FAILURES = 10;

export interface HeartbeatStatus {
  configured: boolean;
  lastOkAt: string | null;
  lastFailureAt: string | null;
  lastFailure: string | null;
  /** The last minute the bridge did NOT ping because it was not healthy — the silence is what the watcher alerts on. */
  lastSkippedAt: string | null;
}

// R9 — the dead man's hand. Every minute a healthy bridge pings an address OUTSIDE the home network and outside bridge itself
// (EXTERNAL_HEARTBEAT_URL: a healthchecks.io check, or anything that alerts when its pings stop). The Dashboard, the board agents and Telegram
// all live inside bridge or behind the home router, so when either dies they go quiet together; this is the one signal that stops by itself —
// and the watcher, which sits elsewhere, is the one that speaks (e-mail, ntfy). Set the check's period to 1 minute and its grace to ~10: «no ping
// for 10 minutes» is the alarm.
//
// The ping means «bridge is HEALTHY» (the same readiness as GET /api/v1/health: the database answers, no migration is pending), not just «the
// process is up» — a bridge that cannot reach its database says nothing, and that silence is intended.
@Injectable()
export class ExternalHeartbeatService {
  private readonly logger = new Logger(ExternalHeartbeatService.name);
  private lastOkAt: Date | null = null;
  private lastFailureAt: Date | null = null;
  private lastFailure: string | null = null;
  private lastSkippedAt: Date | null = null;
  private failuresInRow = 0;
  private alerted = false;

  constructor(
    private readonly app: AppService,
    @Optional() private readonly notifier?: NotifyService,
  ) {}

  private url(): string | null {
    const value = (process.env.EXTERNAL_HEARTBEAT_URL ?? '').trim();

    // https only: the URL is a secret (it is the check's identity) and must not travel in clear.
    return value.startsWith('https://') ? value : null;
  }

  status(): HeartbeatStatus {
    return {
      configured: this.url() !== null,
      lastOkAt: this.lastOkAt?.toISOString() ?? null,
      lastFailureAt: this.lastFailureAt?.toISOString() ?? null,
      lastFailure: this.lastFailure,
      lastSkippedAt: this.lastSkippedAt?.toISOString() ?? null,
    };
  }

  @Interval(PING_EVERY_MS)
  async tick(now = new Date()): Promise<void> {
    const url = this.url();

    if (!url) return;

    // A sick bridge stays silent on purpose.
    if ((await this.app.getHealthStatus()).status !== 'ok') {
      this.lastSkippedAt = now;

      return;
    }

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(PING_TIMEOUT_MS),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      this.lastOkAt = now;
      this.failuresInRow = 0;

      if (this.alerted) {
        this.alerted = false;
        await this.notifier?.send(
          '✅ Внешний сторож (heartbeat) снова получает сигналы от bridge',
        );
      }
    } catch (error) {
      // Never the URL itself: it is the secret that identifies the check.
      this.lastFailureAt = now;
      this.lastFailure = this.describe(error, url);
      this.failuresInRow += 1;

      if (this.failuresInRow === 1 || this.failuresInRow % 30 === 0) {
        this.logger.warn(
          `External heartbeat not delivered: ${this.lastFailure}`,
        );
      }

      if (this.failuresInRow === ALERT_AFTER_FAILURES && !this.alerted) {
        this.alerted = true;
        await this.notifier?.send(
          `⚠️ Heartbeat во внешний сторож не доходит ${ALERT_AFTER_FAILURES} минут подряд (${this.lastFailure}) — он может поднять тревогу, хотя bridge жив. Проверьте адрес и выход bridge в интернет.`,
        );
      }
    }
  }

  private describe(error: unknown, url: string): string {
    const text = error instanceof Error ? error.message : String(error);

    return text.split(url).join('<url>').slice(0, 160);
  }
}
