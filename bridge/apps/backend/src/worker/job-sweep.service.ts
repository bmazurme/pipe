import { Injectable, Logger, Optional } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AppLogService } from '../logs/app-log.service';
import { Job, JobStatus } from './entities/job.entity';
import { logJobOutcome } from './job-outcome-log';

// A worker handles one job at a time and only asks for the next one when it is
// idle. So when it claims, any job still marked claimed/running under its name is
// a run that no longer exists (the process was restarted or killed mid-job) — but
// only once it has been silent this long, so a sibling replica that happens to
// share the name and is genuinely working (it logs and heartbeats) is left alone.
const ORPHAN_SILENCE_MS = 10 * 60_000;
// Backstop for a worker that never comes back: nothing legitimate stays this
// silent (the worker's own job deadline is 30 minutes by default).
const LOST_JOB_SILENCE_MS = 3 * 60 * 60_000;
const SWEEP_EVERY_MS = 5 * 60_000;
const ORPHAN_SWEEP_THROTTLE_MS = 60_000;
const LOST_MESSAGE =
  'Worker was restarted or lost while this job was running — the run did not finish';

@Injectable()
export class JobSweepService {
  private readonly logger = new Logger(JobSweepService.name);
  // `userId:workerName` → when claim() last ran the orphan sweep for it.
  private readonly lastOrphanSweep = new Map<string, number>();

  constructor(
    @InjectRepository(Job)
    private readonly jobRepository: Repository<Job>,
    @Optional() private readonly appLogs?: AppLogService,
  ) {}

  // Marks held-but-dead jobs failed so they stop showing as "running" forever.
  async failLostJobs(
    where: { userId?: number; workerName?: string; workerId?: number },
    silenceMs: number,
  ): Promise<number> {
    const params: unknown[] = [
      JobStatus.Failed,
      LOST_MESSAGE,
      `\n[${LOST_MESSAGE}]\n`,
      new Date(Date.now() - silenceMs),
      JobStatus.Claimed,
      JobStatus.Running,
    ];
    let filters = '';

    if (where.userId !== undefined) {
      params.push(where.userId);
      filters += ` AND "userId" = $${params.length}`;
    }

    if (where.workerName !== undefined) {
      params.push(where.workerName);
      filters += ` AND "workerName" = $${params.length}`;
    }

    if (where.workerId !== undefined) {
      params.push(where.workerId);
      filters += ` AND "workerId" = $${params.length}`;
    }

    // One conditional statement instead of find + save: the status/silence check and
    // the write are atomic, so a job the worker finished in between is never touched.
    // (Raw query result is [rows, affectedCount].)
    const [rows]: [Job[], number] = await this.jobRepository.query(
      `UPDATE jobs SET status = $1, "errorMessage" = $2, "finishedAt" = now(),
         logs = COALESCE(logs, '') || $3, "updatedAt" = now()
       WHERE status IN ($5, $6) AND "updatedAt" < $4${filters}
       RETURNING *`,
      params,
    );

    for (const job of rows) {
      logJobOutcome(this.appLogs, job);
    }

    return rows.length;
  }

  // Backstop for jobs whose worker never returned.
  @Interval(SWEEP_EVERY_MS)
  async sweepLostJobs(): Promise<void> {
    try {
      await this.failLostJobs({}, LOST_JOB_SILENCE_MS);
    } catch (error) {
      this.logger.warn(
        `Lost-job sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // A managed worker asking for work is idle: whatever it still "holds" is lost.
  // Immediately — unlike a legacy name, a key belongs to exactly one process.
  async sweepManagedWorker(userId: number, workerId: number): Promise<void> {
    try {
      await this.failLostJobs({ userId, workerId }, 0);
    } catch (error) {
      this.logger.warn(
        `Lost-job sweep failed during claim: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // A legacy (by-name) worker asking for work is idle: whatever it still "holds" is lost.
  // A failing sweep must not stop the worker from taking new work.
  // Throttled per worker: the threshold is minutes, so sweeping on every ~10 s
  // poll is needless row-locking. A worker's first claim after process start
  // always sweeps (no entry yet).
  async sweepOrphansFor(userId: number, workerName: string): Promise<void> {
    const sweepKey = `${userId}:${workerName}`;
    const lastSweep = this.lastOrphanSweep.get(sweepKey);

    try {
      if (
        lastSweep === undefined ||
        Date.now() - lastSweep >= ORPHAN_SWEEP_THROTTLE_MS
      ) {
        await this.failLostJobs({ userId, workerName }, ORPHAN_SILENCE_MS);
        this.lastOrphanSweep.set(sweepKey, Date.now());
      }
    } catch (error) {
      this.logger.warn(
        `Orphan sweep failed during claim: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
