import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  DAILY_NOISY,
  DAILY_TARGET,
  kindOf,
  type Verdict,
  verdictOf,
} from './alert-budget';
import { NotifyDay } from './entities/notify-day.entity';
import { NotifyKind } from './entities/notify-kind.entity';
import { NotificationSettingsService } from './notification-settings.service';

export type Counter = 'sent' | 'urgent' | 'deduped' | 'grouped' | 'quiet';

const KEEP_DAYS = 45;

export interface BudgetDay {
  day: string;
  sent: number;
  urgent: number;
  deduped: number;
  grouped: number;
  quiet: number;
}

export interface BudgetView {
  target: number;
  noisy: number;
  today: BudgetDay & {
    verdict: Verdict;
    top: Array<{ kind: string; attempts: number }>;
  };
  days: BudgetDay[];
}

// The alert budget's numbers (R6). Never blocks or fails a notification: a counter that cannot be written is a warning in the log.
@Injectable()
export class NotifyStatsService {
  private readonly logger = new Logger(NotifyStatsService.name);
  private lastPrune = 0;

  constructor(
    @InjectRepository(NotifyDay)
    private readonly days: Repository<NotifyDay>,
    @InjectRepository(NotifyKind)
    private readonly kinds: Repository<NotifyKind>,
    private readonly settings: NotificationSettingsService,
  ) {}

  // The owner's local date: «today» is the day he lives, not UTC.
  async dayOf(now: Date): Promise<string> {
    const { timezone } = await this.settings.effective();

    // en-CA writes dates as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now);
  }

  async count(counter: Counter, by = 1, now = new Date()): Promise<void> {
    try {
      const day = await this.dayOf(now);

      await this.days.query(
        `INSERT INTO notify_days (day, "${counter}") VALUES ($1, $2)
         ON CONFLICT (day) DO UPDATE SET "${counter}" = notify_days."${counter}" + $2, "updatedAt" = now()`,
        [day, by],
      );
      await this.prune(now);
    } catch (error) {
      this.logger.warn(
        `Could not count a notification: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async attempt(text: string, now = new Date()): Promise<void> {
    const kind = kindOf(text);

    if (!kind) return;

    try {
      const day = await this.dayOf(now);

      await this.kinds.query(
        `INSERT INTO notify_kinds (day, kind, attempts) VALUES ($1, $2, 1)
         ON CONFLICT (day, kind) DO UPDATE SET attempts = notify_kinds.attempts + 1, "updatedAt" = now()`,
        [day, kind],
      );
    } catch (error) {
      this.logger.warn(
        `Could not count a notification kind: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Old days go once a day, from a write that is happening anyway.
  private async prune(now: Date): Promise<void> {
    if (now.getTime() - this.lastPrune < 24 * 60 * 60_000) return;

    this.lastPrune = now.getTime();

    const cutoff = await this.dayOf(
      new Date(now.getTime() - KEEP_DAYS * 24 * 60 * 60_000),
    );

    await this.days.query(`DELETE FROM notify_days WHERE day < $1`, [cutoff]);
    await this.kinds.query(`DELETE FROM notify_kinds WHERE day < $1`, [cutoff]);
  }

  async budget(days = 14, now = new Date()): Promise<BudgetView> {
    const today = await this.dayOf(now);
    const since = await this.dayOf(
      new Date(now.getTime() - (days - 1) * 24 * 60 * 60_000),
    );
    const rows = await this.days
      .createQueryBuilder('d')
      .where('d.day >= :since', { since })
      .orderBy('d.day', 'DESC')
      .getMany();
    const top = await this.kinds
      .createQueryBuilder('k')
      .where('k.day = :today', { today })
      .orderBy('k.attempts', 'DESC')
      .limit(8)
      .getMany();
    const toDay = (row: NotifyDay): BudgetDay => ({
      day: row.day,
      sent: row.sent,
      urgent: row.urgent,
      deduped: row.deduped,
      grouped: row.grouped,
      quiet: row.quiet,
    });
    const todays = rows.find((row) => row.day === today);
    const todayView = todays
      ? toDay(todays)
      : { day: today, sent: 0, urgent: 0, deduped: 0, grouped: 0, quiet: 0 };

    return {
      target: DAILY_TARGET,
      noisy: DAILY_NOISY,
      today: {
        ...todayView,
        verdict: verdictOf(todayView.sent),
        top: top.map((row) => ({ kind: row.kind, attempts: row.attempts })),
      },
      days: rows.map(toDay),
    };
  }
}
