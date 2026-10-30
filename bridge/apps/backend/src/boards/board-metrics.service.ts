import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  assessBoardMetrics,
  BoardMetricsAssessment,
  BoardMetricsData,
  bucketSeconds,
  SeriesPoint,
} from './board-metrics';
import { BoardMetricsDto } from './dto/board-metrics.dto';
import { BoardMetric } from './entities/board-metric.entity';

export const RETENTION_DAYS = 7;
export const MAX_HOURS = RETENTION_DAYS * 24;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const PRUNE_EVERY_MS = HOUR_MS;

export interface BoardMetricsView extends BoardMetricsAssessment {
  host: string;
  at: string;
  data: BoardMetricsData;
  series: SeriesPoint[];
}

interface LatestRow {
  host: string;
  at: Date;
  data: BoardMetricsData;
}

interface SeriesRow {
  host: string;
  t: string;
  soc: string | null;
  nvme: string | null;
}

@Injectable()
export class BoardMetricsService {
  private readonly logger = new Logger(BoardMetricsService.name);
  private lastPrune = 0;

  constructor(
    @InjectRepository(BoardMetric)
    private readonly metrics: Repository<BoardMetric>,
  ) {}

  // One reading from a board's agent. Old rows go once an hour, from the same call that writes: no scheduler of its own to keep alive.
  async record(
    userId: number,
    dto: BoardMetricsDto,
    now = new Date(),
  ): Promise<void> {
    const { host, ...data } = dto;

    await this.metrics.insert({ userId, host, at: now, data });
    await this.prune(now);
  }

  private async prune(now: Date): Promise<void> {
    if (now.getTime() - this.lastPrune < PRUNE_EVERY_MS) return;

    this.lastPrune = now.getTime();

    try {
      await this.metrics
        .createQueryBuilder()
        .delete()
        .where('"at" < :before', {
          before: new Date(now.getTime() - RETENTION_DAYS * DAY_MS),
        })
        .execute();
    } catch (error) {
      this.logger.warn(
        `Could not prune the board metrics: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // The newest reading of each board with the verdict, and the graph of the last `hours` hours (an average per bucket).
  async summary(
    userId: number,
    hours: number,
    now = new Date(),
  ): Promise<BoardMetricsView[]> {
    const window = Math.min(Math.max(Math.round(hours), 1), MAX_HOURS);
    const bucket = bucketSeconds(window);
    const from = new Date(now.getTime() - window * HOUR_MS);
    const latest = (await this.metrics.query(
      `SELECT DISTINCT ON (host) host, "at", data FROM board_metrics WHERE "userId" = $1 ORDER BY host, "at" DESC`,
      [userId],
    )) as LatestRow[];
    const series = (await this.metrics.query(
      `SELECT host,
              floor(extract(epoch from "at") / $3) * $3 AS t,
              avg(("data"->>'socTempC')::float) AS soc,
              avg(("data"->>'nvmeTempC')::float) AS nvme
         FROM board_metrics
        WHERE "userId" = $1 AND "at" >= $2
        GROUP BY host, t
        ORDER BY host, t`,
      [userId, from, bucket],
    )) as SeriesRow[];
    const byHost = new Map<string, SeriesPoint[]>();

    for (const row of series) {
      const points = byHost.get(row.host) ?? [];

      points.push({
        t: new Date(Number(row.t) * 1000).toISOString(),
        soc: row.soc === null ? null : Math.round(Number(row.soc) * 10) / 10,
        nvme: row.nvme === null ? null : Math.round(Number(row.nvme) * 10) / 10,
      });
      byHost.set(row.host, points);
    }

    return latest.map((row) => ({
      host: row.host,
      at: new Date(row.at).toISOString(),
      data: row.data,
      series: byHost.get(row.host) ?? [],
      ...assessBoardMetrics(row.data, new Date(row.at), now),
    }));
  }
}
