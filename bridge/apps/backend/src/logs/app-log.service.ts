import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, In, LessThan, MoreThanOrEqual, Repository } from 'typeorm';

import { AppLog, AppLogLevel, AppLogSource } from './entities/app-log.entity';
import { redact, sanitizeMeta } from './redact';
import { summarize, LogSummary } from './summary';

const DEFAULT_RETENTION_DAYS = 30;
export const MAX_EXPORT_ROWS = 20_000;

export interface RecordInput {
  level: AppLogLevel;
  source: AppLogSource;
  event: string;
  message: string;
  meta?: Record<string, unknown>;
}

export interface LogQuery {
  level?: AppLogLevel;
  levels?: AppLogLevel[];
  source?: AppLogSource;
  q?: string;
  days?: number;
  limit?: number;
}

export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function parseRetentionDays(
  raw: string | undefined,
  logger: Pick<Logger, 'warn'> = new Logger(AppLogService.name),
): number {
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_RETENTION_DAYS;
  }

  const trimmed = raw.trim();
  const days = Number(trimmed);

  if (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(days) || days < 1) {
    logger.warn(
      `LOG_RETENTION_DAYS="${raw}" is not a positive integer; using ${DEFAULT_RETENTION_DAYS} days`,
    );

    return DEFAULT_RETENTION_DAYS;
  }

  return days;
}

function since(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

// Operational log for later tuning. record() is fire-and-forget by contract:
// instrumentation must never be able to fail (or slow) the code it observes.
@Injectable()
export class AppLogService {
  private readonly logger = new Logger(AppLogService.name);
  private readonly retentionDays: number;

  constructor(
    @InjectRepository(AppLog)
    private readonly repository: Repository<AppLog>,
    private readonly configService: ConfigService,
  ) {
    this.retentionDays = parseRetentionDays(
      this.configService.get<string>('LOG_RETENTION_DAYS'),
      this.logger,
    );
  }

  async record(input: RecordInput): Promise<void> {
    try {
      await this.repository.save({
        level: input.level,
        source: input.source,
        event: input.event.slice(0, 64),
        message: redact(input.message).slice(0, 500),
        meta: sanitizeMeta(input.meta),
      });
    } catch (error) {
      // Deliberately not rethrown, and logged to the console only.
      this.logger.warn(
        `Could not store an app log: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  list(query: LogQuery): Promise<AppLog[]> {
    return this.repository.find({
      where: {
        createdAt: MoreThanOrEqual(since(query.days ?? 7)),
        ...(query.level ? { level: query.level } : {}),
        ...(query.levels?.length ? { level: In(query.levels) } : {}),
        ...(query.source ? { source: query.source } : {}),
        ...(query.q ? { message: ILike(`%${escapeLike(query.q)}%`) } : {}),
      },
      order: { id: 'DESC' },
      take: Math.min(Math.max(query.limit ?? 100, 1), 500),
    });
  }

  async summary(days: number): Promise<LogSummary> {
    const rows = await this.exportRows(days);

    return {
      ...summarize(rows, days),
      truncated: rows.length >= MAX_EXPORT_ROWS,
    };
  }

  // Oldest first, capped to the NEWEST rows of the window — the export is for
  // feeding an analysis, not paging.
  async exportRows(days: number): Promise<AppLog[]> {
    const rows = await this.repository.find({
      where: { createdAt: MoreThanOrEqual(since(days)) },
      order: { id: 'DESC' },
      take: MAX_EXPORT_ROWS,
    });

    return rows.reverse();
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async prune(): Promise<void> {
    const days = this.retentionDays;

    try {
      const result = await this.repository.delete({
        createdAt: LessThan(since(days)),
      });

      if (result.affected) {
        this.logger.log(
          `Pruned ${result.affected} app logs older than ${days}d`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `App log prune failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
