import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, MoreThanOrEqual, Repository } from 'typeorm';

import { AppLog, AppLogLevel, AppLogSource } from './entities/app-log.entity';
import { redact, sanitizeMeta } from './redact';
import { summarize, LogSummary } from './summary';

const DEFAULT_RETENTION_DAYS = 30;
const MAX_EXPORT_ROWS = 20_000;

export interface RecordInput {
  level: AppLogLevel;
  source: AppLogSource;
  event: string;
  message: string;
  meta?: Record<string, unknown>;
}

export interface LogQuery {
  level?: AppLogLevel;
  source?: AppLogSource;
  days?: number;
  limit?: number;
}

function since(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

// Operational log for later tuning. record() is fire-and-forget by contract:
// instrumentation must never be able to fail (or slow) the code it observes.
@Injectable()
export class AppLogService {
  private readonly logger = new Logger(AppLogService.name);

  constructor(
    @InjectRepository(AppLog)
    private readonly repository: Repository<AppLog>,
    private readonly configService: ConfigService,
  ) {}

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
        ...(query.source ? { source: query.source } : {}),
      },
      order: { id: 'DESC' },
      take: Math.min(Math.max(query.limit ?? 100, 1), 500),
    });
  }

  async summary(days: number): Promise<LogSummary> {
    const rows = await this.repository.find({
      where: { createdAt: MoreThanOrEqual(since(days)) },
      order: { id: 'ASC' },
      take: MAX_EXPORT_ROWS,
    });

    return summarize(rows, days);
  }

  // Oldest first, capped — the export is for feeding an analysis, not paging.
  exportRows(days: number): Promise<AppLog[]> {
    return this.repository.find({
      where: { createdAt: MoreThanOrEqual(since(days)) },
      order: { id: 'ASC' },
      take: MAX_EXPORT_ROWS,
    });
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async prune(): Promise<void> {
    const days =
      Number(this.configService.get<string>('LOG_RETENTION_DAYS')) ||
      DEFAULT_RETENTION_DAYS;

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
