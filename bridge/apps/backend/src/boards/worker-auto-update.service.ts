import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Job, JobStatus } from '../worker/entities/job.entity';
import { BoardsService } from './boards.service';
import { BoardAutoUpdateSettings } from './entities/board-auto-update-settings.entity';
import { BoardReport } from './entities/board-report.entity';
import { ScriptUpdate } from './entities/script-update.entity';
import {
  type BoardFacts,
  decide,
  DEFAULT_TIMEZONE,
  DEFAULT_WINDOW,
  inWindow,
  SETTLE_MS,
  validateWindow,
  workerNameOf,
} from './worker-auto-update';

const CHECK_EVERY_MS = 5 * 60_000;
// The board reports about hourly; an update is decided only on a report this young (the digests in it are what the decision is made from).
const FRESH_REPORT_MS = 3 * 60 * 60_000;

export interface AutoUpdateView {
  enabled: boolean;
  window: string;
  timezone: string;
  /** Whether it is the window now (so the owner sees why nothing happens). */
  inWindowNow: boolean;
  /** The newest automatic decision and how it ended, if any. */
  last: {
    host: string;
    status: string;
    at: string | null;
    result: string | null;
  } | null;
}

@Injectable()
export class WorkerAutoUpdateService {
  private readonly logger = new Logger(WorkerAutoUpdateService.name);
  private running = false;

  constructor(
    @InjectRepository(BoardAutoUpdateSettings)
    private readonly settings: Repository<BoardAutoUpdateSettings>,
    @InjectRepository(BoardReport)
    private readonly reports: Repository<BoardReport>,
    @InjectRepository(ScriptUpdate)
    private readonly updates: Repository<ScriptUpdate>,
    @InjectRepository(Job)
    private readonly jobs: Repository<Job>,
    private readonly boards: BoardsService,
  ) {}

  async view(userId: number, now = new Date()): Promise<AutoUpdateView> {
    const row = await this.settings.findOne({ where: { userId } });
    const window = row?.window ?? DEFAULT_WINDOW;
    const timezone = row?.timezone ?? DEFAULT_TIMEZONE;
    const last = await this.updates.findOne({
      where: { userId, kind: 'worker', via: 'auto' },
      order: { id: 'DESC' },
    });

    return {
      enabled: row?.enabled ?? false,
      window,
      timezone,
      inWindowNow: inWindow(window, timezone, now),
      last: last
        ? {
            host: last.host,
            status: last.status,
            at: (last.finishedAt ?? last.createdAt).toISOString(),
            result: last.result,
          }
        : null,
    };
  }

  // Returns the problem when the settings cannot be saved, null when saved.
  async save(
    userId: number,
    input: { enabled: boolean; window: string; timezone: string },
  ): Promise<string | null> {
    const problem = validateWindow(input.window);

    if (problem) return problem;

    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: input.timezone });
    } catch {
      return 'Неизвестный часовой пояс';
    }

    await this.settings.upsert(
      {
        userId,
        enabled: input.enabled,
        window: input.window.trim().toLowerCase(),
        timezone: input.timezone,
      },
      ['userId'],
    );

    return null;
  }

  @Interval(CHECK_EVERY_MS)
  async tick(): Promise<void> {
    if (this.running) return;

    this.running = true;

    try {
      const enabled = await this.settings.find({ where: { enabled: true } });

      for (const row of enabled) await this.runFor(row);
    } catch (error) {
      this.logger.warn(
        `Worker auto-update check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  // At most ONE decision per user per check. Returns the host it made a decision for, or null.
  async runFor(
    row: BoardAutoUpdateSettings,
    now = new Date(),
  ): Promise<string | null> {
    if (!inWindow(row.window, row.timezone, now)) return null;

    const reports = await this.reports.find({ where: { userId: row.userId } });
    const withWorkers = reports.filter(
      (report) => (report.health?.workers?.length ?? 0) > 0,
    );
    const hosts = withWorkers.map((report) => report.host);

    if (hosts.length === 0) return null;

    const decisions = await this.updates.find({
      where: { userId: row.userId, kind: 'worker', host: In(hosts) },
      order: { id: 'DESC' },
    });
    const lastOf = (host: string) =>
      decisions.find((decision) => decision.host === host) ?? null;
    // One board at a time: another has a decision waiting, or finished one a moment ago.
    const busyBoards = new Set(
      decisions
        .filter(
          (decision) =>
            decision.status === 'pending' ||
            (decision.finishedAt !== null &&
              now.getTime() - decision.finishedAt.getTime() < SETTLE_MS),
        )
        .map((decision) => decision.host),
    );

    for (const report of withWorkers) {
      const last = lastOf(report.host);
      const names = (report.health?.workers ?? []).map((worker) =>
        workerNameOf(worker.name),
      );
      const busyJobs = await this.jobs.count({
        where: {
          userId: row.userId,
          workerName: In(names),
          status: In([JobStatus.Claimed, JobStatus.Running]),
        },
      });
      const facts: BoardFacts = {
        host: report.host,
        reportedAt: report.reportedAt,
        workers: report.health?.workers ?? [],
        latest: report.health?.workerImageLatest,
        pending: last?.status === 'pending',
        last: last
          ? {
              status: last.status,
              finishedAt: last.finishedAt,
              targetDigest: last.targetDigest,
            }
          : null,
        busyJobs,
        fresh: now.getTime() - report.reportedAt.getTime() <= FRESH_REPORT_MS,
      };
      const verdict = decide(facts, {
        now,
        anyOtherBusy: [...busyBoards].some((host) => host !== report.host),
      });

      if (!verdict.update) continue;

      try {
        await this.boards.requestWorkerUpdate(
          row.userId,
          report.host,
          'auto',
          verdict.digest,
        );
        this.logger.log(
          `Board ${report.host}: worker update requested automatically (release ${verdict.digest.slice(0, 19)})`,
        );

        return report.host;
      } catch (error) {
        this.logger.warn(
          `Board ${report.host}: automatic worker update not requested: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return null;
  }
}
