import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { NotifyService } from '../telegram/notify.service';
import { RestoreDrillReportDto } from './dto/restore-drill.dto';
import { RestoreDrill } from './entities/restore-drill.entity';
import {
  assessDrills,
  type DrillAssessment,
  type DrillData,
  drillAlert,
  type DrillRow,
} from './restore-drill';

// Enough for «the last ok one» and «the one before it» even through a run of failures, and a year of months.
const KEEP = 24;
const CHECK_EVERY_MS = 60 * 60_000;
const ALERT_EVERY_MS = 24 * 60 * 60_000;
const TABLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
const MAX_COUNTED_TABLES = 40;

export interface DrillView extends DrillAssessment {
  recent: {
    ranAt: string;
    host: string;
    ok: boolean;
    backupCreatedAt: string | null;
    restoreSeconds: number | null;
    tables: number | null;
    rows: number | null;
    lastMigration: string | null;
    error: string | null;
  }[];
  counts: Record<string, number>;
}

function cleanCounts(
  counts: Record<string, unknown> | null | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};

  for (const [table, value] of Object.entries(counts ?? {})) {
    if (Object.keys(out).length >= MAX_COUNTED_TABLES) break;

    if (
      TABLE_NAME.test(table) &&
      Number.isInteger(value) &&
      (value as number) >= 0
    ) {
      out[table] = value as number;
    }
  }

  return out;
}

@Injectable()
export class RestoreDrillService {
  private readonly logger = new Logger(RestoreDrillService.name);
  // In memory, like the drift digest: a restart repeats at most one message per day, and never one on boot itself.
  private lastAlertAt = Date.now();

  constructor(
    @InjectRepository(RestoreDrill)
    private readonly drills: Repository<RestoreDrill>,
    private readonly notifier: NotifyService,
  ) {}

  async record(
    userId: number,
    dto: RestoreDrillReportDto,
    now = new Date(),
  ): Promise<void> {
    const data: DrillData = {
      host: dto.host,
      ok: dto.ok,
      backupCreatedAt: dto.backupCreatedAt ?? null,
      restoreSeconds: dto.restoreSeconds ?? null,
      tables: dto.tables ?? null,
      rows: dto.rows ?? null,
      counts: cleanCounts(dto.counts),
      lastMigration: dto.lastMigration ?? null,
      error: dto.ok ? null : (dto.error ?? null),
    };

    await this.drills.insert({ userId, ranAt: now, data });

    const old = await this.drills.find({
      where: { userId },
      order: { ranAt: 'DESC', id: 'DESC' },
      skip: KEEP,
      select: { id: true },
    });

    if (old.length > 0) await this.drills.delete(old.map((row) => row.id));

    // A failed drill is told at once; the daily reminder below covers «late», which no report announces.
    if (!dto.ok) await this.alert(userId, now);
  }

  async view(userId: number, now = new Date()): Promise<DrillView> {
    const rows = await this.load(userId);
    const assessment = assessDrills(rows, now);
    const lastOk = rows.find((row) => row.data.ok);

    return {
      ...assessment,
      counts: lastOk?.data.counts ?? {},
      recent: rows.slice(0, 6).map((row) => ({
        ranAt: row.ranAt.toISOString(),
        host: row.data.host,
        ok: row.data.ok,
        backupCreatedAt: row.data.backupCreatedAt ?? null,
        restoreSeconds: row.data.restoreSeconds ?? null,
        tables: row.data.tables ?? null,
        rows: row.data.rows ?? null,
        lastMigration: row.data.lastMigration ?? null,
        error: row.data.error ?? null,
      })),
    };
  }

  // «Not done for more than 35 days» is the one case no report announces, so something has to look. One message a day while it stays true.
  @Interval(CHECK_EVERY_MS)
  async lateTick(): Promise<void> {
    if (Date.now() - this.lastAlertAt < ALERT_EVERY_MS) return;

    try {
      const rows = await this.drills
        .createQueryBuilder('d')
        .select('DISTINCT d.userId', 'userId')
        .getRawMany<{ userId: number }>();

      for (const { userId } of rows)
        await this.alert(Number(userId), new Date());
    } catch (error) {
      this.logger.warn(
        `Restore-drill check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async alert(userId: number, now: Date): Promise<void> {
    const text = drillAlert(assessDrills(await this.load(userId), now));

    if (text && (await this.notifier.send(text, { urgent: true }))) {
      this.lastAlertAt = Date.now();
    }
  }

  private async load(userId: number): Promise<DrillRow[]> {
    const rows = await this.drills.find({
      where: { userId },
      order: { ranAt: 'DESC', id: 'DESC' },
      take: KEEP,
    });

    return rows.map((row) => ({ ranAt: row.ranAt, data: row.data }));
  }
}
