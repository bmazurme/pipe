import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { NotifyService } from '../telegram/notify.service';
import { Worker } from '../worker/entities/worker.entity';
import { BoardsService } from './boards.service';
import { assessDrift, type DriftView, driftDigest } from './drift';
import { BoardReport } from './entities/board-report.entity';

const DIGEST_EVERY_MS = 24 * 60 * 60_000;
const CHECK_EVERY_MS = 30 * 60_000;
// A worker that has not polled for this long is off, not out of date: its version says nothing about now.
const WORKER_ONLINE_WITHIN_MS = 10 * 60_000;

@Injectable()
export class DriftService {
  private readonly logger = new Logger(DriftService.name);
  // In memory: a restart of bridge starts the day again, which costs at most one repeated message — and not one on boot itself.
  private lastDigestAt = Date.now();

  constructor(
    private readonly boards: BoardsService,
    private readonly notifier: NotifyService,
    @InjectRepository(BoardReport)
    private readonly reports: Repository<BoardReport>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
  ) {}

  async view(userId: number, now = new Date()): Promise<DriftView> {
    const [boards, workers] = await Promise.all([
      this.boards.list(userId),
      this.workers.find({ where: { userId } }),
    ]);

    return assessDrift(
      boards.map((board) => ({
        host: board.host,
        reportedAt: board.reportedAt,
        online: board.online,
        outdatedScripts: board.outdated,
        workers: board.workers,
        workerLast: board.workerLast,
        lastUpdate: board.lastUpdate,
      })),
      workers.map((worker) => ({
        name: worker.name,
        version: worker.version,
        enabled: worker.enabled,
        online:
          worker.lastSeenAt !== null &&
          now.getTime() - worker.lastSeenAt.getTime() < WORKER_ONLINE_WITHIN_MS,
      })),
      now,
    );
  }

  // One message a day, and only when there is something to say. The checks are cheap and the day is counted from the last message, so
  // a slow Telegram or a restart cannot turn this into a message per check.
  @Interval(CHECK_EVERY_MS)
  async digestTick(): Promise<void> {
    if (Date.now() - this.lastDigestAt < DIGEST_EVERY_MS) return;

    try {
      const rows = await this.reports
        .createQueryBuilder('r')
        .select('DISTINCT r.userId', 'userId')
        .getRawMany<{ userId: number }>();

      for (const { userId } of rows) {
        const text = driftDigest(await this.view(Number(userId)));

        if (text && (await this.notifier.send(text))) {
          this.lastDigestAt = Date.now();
        }
      }
    } catch (error) {
      this.logger.warn(
        `Drift digest failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
