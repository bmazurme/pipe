import { Injectable, Logger, Optional } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { tunnelProxyUrl } from '../common/tunnel-proxy';
import { AppLogService } from '../logs/app-log.service';
import { AlertFallbackService } from './alert-fallback.service';
import { TelegramService } from './telegram.service';

const CHECK_EVERY_MS = 30_000;
// While Telegram stays down it is said again this often, not once.
const REMIND_EVERY_MS = 60 * 60_000;
// Without a call of its own for this long (the poller is off) the health check asks Telegram itself.
const PROBE_AFTER_IDLE_MS = 90_000;

export function formatMoscow(at: Date): string {
  return at.toLocaleTimeString('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));

  if (minutes < 60) return `${minutes} мин`;

  const hours = Math.floor(minutes / 60);

  return `${hours} ч ${minutes % 60} мин`;
}

// Watches whether Telegram can be reached and says so through the other way out when it cannot: the alert every other alert depends on
// is the one that would otherwise never arrive.
@Injectable()
export class TelegramHealthService {
  private readonly logger = new Logger(TelegramHealthService.name);
  // The outage that was announced: when it began and when it was last said.
  private announced: { since: number; lastAt: number } | null = null;
  private checking = false;

  constructor(
    private readonly telegram: TelegramService,
    private readonly fallback: AlertFallbackService,
    @Optional() private readonly appLogs?: AppLogService,
  ) {}

  @Interval(CHECK_EVERY_MS)
  async check(now = Date.now()): Promise<void> {
    if (this.checking || !this.telegram.isConfigured()) return;

    this.checking = true;

    try {
      const before = this.telegram.health(now);

      // A quiet system makes no calls, and the health would then never change: ask once in a while.
      if (
        !before.lastAttemptAt ||
        now - before.lastAttemptAt.getTime() >= PROBE_AFTER_IDLE_MS
      ) {
        await this.telegram.api('getMe', {}, 8_000);
      }

      const health = this.telegram.health(now);

      if (health.down && health.failingSince) {
        await this.onDown(health.failingSince.getTime(), health.lastError, now);
      } else if (!health.down && this.announced) {
        await this.onRecovered(now);
      }
    } finally {
      this.checking = false;
    }
  }

  private async onDown(
    since: number,
    error: string | null,
    now: number,
  ): Promise<void> {
    if (this.announced && now - this.announced.lastAt < REMIND_EVERY_MS) return;

    const first = !this.announced;
    const path = tunnelProxyUrl()
      ? 'через туннель bridge (активное подключение)'
      : 'через прокси из окружения';
    const text =
      `🔴 Telegram недоступен ${first ? 'с' : 'всё ещё, с'} ${formatMoscow(new Date(since))} (${formatDuration(now - since)})` +
      `${error ? `: ${error}` : ''}. Запросы идут ${path}. ` +
      'Срочные уведомления приходят сюда, пока Telegram не вернётся.';

    this.announced = { since: this.announced?.since ?? since, lastAt: now };

    const delivered = this.fallback.isConfigured()
      ? await this.fallback.send(text)
      : false;

    this.logger.warn(
      `${text}${delivered ? '' : this.fallback.isConfigured() ? ' (запасной канал не принял)' : ' (запасной канал не настроен — предупредить некому)'}`,
    );
    void this.appLogs?.record({
      level: 'error',
      source: 'integration',
      event: 'telegram.down',
      message: text,
      meta: { fallbackConfigured: this.fallback.isConfigured(), delivered },
    });
  }

  private async onRecovered(now: number): Promise<void> {
    const announced = this.announced as { since: number };

    this.announced = null;

    const text = `✅ Telegram снова доступен (не работал ${formatDuration(now - announced.since)}, с ${formatMoscow(new Date(announced.since))}).`;

    // Telegram first — it is the main way — and the other channel too, so that whoever got the alarm there also gets the all-clear.
    await this.telegram.send(text);
    if (this.fallback.isConfigured()) await this.fallback.send(text);

    this.logger.log(text);
    void this.appLogs?.record({
      level: 'info',
      source: 'integration',
      event: 'telegram.up',
      message: text,
    });
  }
}
