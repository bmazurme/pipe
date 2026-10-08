import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { ContextService } from '../context/context.service';
import { AppLogService } from '../logs/app-log.service';
import { StorageService } from '../storage/storage.service';
import {
  StoredFile,
  StoredFileDirection,
} from '../storage/entities/stored-file.entity';
import { ClaudeCredentialsService } from './claude-credentials.service';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobStatusDto } from './dto/update-job-status.dto';
import { Job, JobStatus } from './entities/job.entity';
import { buildRunHistory, FINISHED_STATUSES } from './run-history';
import { WorkerHeartbeatService } from './worker-heartbeat.service';

const ENCRYPTED_SUFFIX = '.enc';

// More than the history keeps, so a few unreadable rows cannot starve it.
const HISTORY_LOOKUP = 12;

// What identifies "the same task" across runs: a pipeline parcel's own key (stable for an
// issue however many times it is re-pushed), else the plain file itself.
function taskKeyOf(sourceFile: { id: number; taskKey: string | null }): string {
  return sourceFile.taskKey ?? `file:${sourceFile.id}`;
}

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
const LOST_MESSAGE =
  'Worker was restarted or lost while this job was running — the run did not finish';

@Injectable()
export class WorkerService {
  private readonly logger = new Logger(WorkerService.name);

  constructor(
    @InjectRepository(Job)
    private readonly jobRepository: Repository<Job>,
    private readonly storageService: StorageService,
    private readonly claudeCredentialsService: ClaudeCredentialsService,
    private readonly heartbeatService: WorkerHeartbeatService,
    private readonly contextService: ContextService,
    @Optional() private readonly appLogs?: AppLogService,
  ) {}

  // `carried` is for a retry: it reuses the original job's own snapshots, so the retry
  // runs with exactly the context and history the first attempt had, even if the saved
  // context was edited or deleted (or more runs happened) since.
  async create(
    userId: number,
    dto: CreateJobDto,
    carried?: {
      context?: { name: string; text: string };
      history?: { text: string; count: number } | null;
    },
  ): Promise<Job> {
    const sourceFile = await this.storageService.findOwned(
      dto.sourceFileId,
      userId,
    );

    if (sourceFile.originalName.endsWith(ENCRYPTED_SUFFIX)) {
      throw new BadRequestException(
        'Worker only accepts unencrypted parcels — this file is encrypted',
      );
    }

    if (dto.claudeCredentialId !== undefined) {
      const token = await this.claudeCredentialsService.resolveToken(
        dto.claudeCredentialId,
        userId,
      );
      if (token === null) {
        throw new BadRequestException('Claude credential not found');
      }
    }

    // Nothing is attached unless the owner chose a context; a chosen one is copied onto
    // the job (see Job.contextText) rather than referenced.
    const context =
      carried?.context ??
      (dto.contextId !== undefined
        ? await this.contextService
            .findOwned(dto.contextId, userId)
            .then((found) => ({ name: found.name, text: found.content }))
        : undefined);

    const taskKey = taskKeyOf(sourceFile);
    const history =
      carried !== undefined
        ? (carried.history ?? null)
        : dto.includeHistory
          ? await this.runHistory(userId, taskKey)
          : null;

    return this.jobRepository.save({
      userId,
      sourceFileId: sourceFile.id,
      taskKey,
      contextName: context?.name ?? null,
      contextText: context?.text ?? null,
      historyText: history?.text ?? null,
      historyCount: history?.count ?? null,
      model: dto.model,
      claudeCredentialId: dto.claudeCredentialId ?? null,
      status: JobStatus.Queued,
    });
  }

  // Runs a failed (or stopped) job again as a NEW job over the same parcel, model
  // and credential — the original stays as history, so its log and error remain
  // readable. The parcel is only consumed when a job succeeds, so a failed job's
  // source is still there; if it was removed since, create() says so.
  async retry(id: number, userId: number): Promise<Job> {
    const job = await this.findOwned(id, userId);

    if (job.status !== JobStatus.Failed && job.status !== JobStatus.Cancelled) {
      throw new ConflictException(
        `Only a failed or stopped job can be retried — this one is ${job.status}`,
      );
    }

    if (job.sourceFileId === null) {
      throw new ConflictException('The source parcel was already consumed');
    }

    const retried = await this.create(
      userId,
      {
        sourceFileId: job.sourceFileId,
        model: job.model,
        ...(job.claudeCredentialId !== null
          ? { claudeCredentialId: job.claudeCredentialId }
          : {}),
      },
      {
        context:
          job.contextText !== null && job.contextName !== null
            ? { name: job.contextName, text: job.contextText }
            : undefined,
        history:
          job.historyText !== null && job.historyCount !== null
            ? { text: job.historyText, count: job.historyCount }
            : null,
      },
    );

    void this.appLogs?.record({
      level: 'info',
      source: 'job',
      event: 'job.retried',
      message: `Job ${job.id} retried as job ${retried.id}`,
      meta: { jobId: job.id, retryJobId: retried.id, model: job.model },
    });

    return retried;
  }

  // The finished runs of the same task (same parcel key), newest first, summarised.
  private async runHistory(
    userId: number,
    taskKey: string,
  ): Promise<{ text: string; count: number } | null> {
    const earlier = await this.jobRepository.find({
      where: { userId, taskKey, status: In(FINISHED_STATUSES) },
      order: { finishedAt: 'DESC', id: 'DESC' },
      take: HISTORY_LOOKUP,
    });

    return buildRunHistory(earlier);
  }

  // How many earlier runs of this parcel's task could be mixed in — for the launch form.
  async previewHistory(
    userId: number,
    sourceFileId: number,
  ): Promise<{ count: number }> {
    const sourceFile = await this.storageService.findOwned(
      sourceFileId,
      userId,
    );
    const history = await this.runHistory(userId, taskKeyOf(sourceFile));

    return { count: history?.count ?? 0 };
  }

  async findAllByUser(userId: number): Promise<Job[]> {
    // `logs` is unbounded and appended on every worker flush, and a context or history
    // can be tens of KB — the list view needs none of them, so they are left out of the
    // SELECT (GET :id returns the logs; the context/history text only ever goes to the worker).
    const columns = this.jobRepository.metadata.columns
      .map((column) => column.propertyName as keyof Job)
      .filter(
        (name) =>
          name !== 'logs' && name !== 'contextText' && name !== 'historyText',
      );

    return this.jobRepository.find({
      select: columns,
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOwned(id: number, userId: number): Promise<Job> {
    const job = await this.jobRepository.findOne({ where: { id, userId } });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    return job;
  }

  async remove(id: number, userId: number): Promise<void> {
    const job = await this.findOwned(id, userId);

    if (job.status === JobStatus.Claimed || job.status === JobStatus.Running) {
      throw new BadRequestException(
        `Cannot remove a job while it's ${job.status} — wait for it to finish`,
      );
    }

    await this.jobRepository.delete(job.id);
  }

  // Claim-less liveness ping — a worker busy running one long job never
  // reaches claim() again, so without this it would look down after
  // STALE_AFTER_MS (see WorkerHeartbeatService).
  async recordHeartbeat(userId: number, workerName: string): Promise<void> {
    await this.heartbeatService.record(userId, workerName);
  }

  // Atomically takes the oldest queued job for this account — the subquery's
  // FOR UPDATE SKIP LOCKED is what makes this safe against two worker
  // processes polling the same account at once (each gets a different row,
  // or nothing, never the same one).
  // Marks held-but-dead jobs failed so they stop showing as "running" forever.
  private async failLostJobs(
    where: { userId?: number; workerName?: string },
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

    // One conditional statement instead of find + save: the status/silence check and
    // the write are atomic, so a job the worker finished in between is never touched.
    // (Raw query result is [rows, affectedCount] — see claim().)
    const [rows]: [Job[], number] = await this.jobRepository.query(
      `UPDATE jobs SET status = $1, "errorMessage" = $2, "finishedAt" = now(),
         logs = COALESCE(logs, '') || $3, "updatedAt" = now()
       WHERE status IN ($5, $6) AND "updatedAt" < $4${filters}
       RETURNING *`,
      params,
    );

    for (const job of rows) {
      this.logJobOutcome(job);
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

  async claim(userId: number, workerName?: string): Promise<Job | null> {
    // Recorded unconditionally — this is the actual liveness signal (see
    // WorkerHeartbeatService): a worker polling an empty queue still proves
    // it's alive here even though nothing below changes a single Job row.
    if (workerName) {
      await this.heartbeatService.record(userId, workerName);
      // It is asking for work, so it is idle: whatever it still "holds" is lost.
      // A failing sweep must not stop the worker from taking new work.
      try {
        await this.failLostJobs({ userId, workerName }, ORPHAN_SILENCE_MS);
      } catch (error) {
        this.logger.warn(
          `Orphan sweep failed during claim: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // node-postgres's driver (via TypeORM's Repository.query) returns
    // [rows, affectedCount] for an UPDATE/INSERT/DELETE — even one with a
    // RETURNING clause — not a flat rows array the way a plain SELECT does.
    // Indexing straight into the result ([0]?.id) silently reads the rows
    // array itself as if it were the first row, always finding no `.id` and
    // reporting "nothing to claim" even though the UPDATE just committed.
    const [rows]: [{ id: number }[], number] = await this.jobRepository.query(
      `UPDATE jobs SET status = $1, "claimedAt" = now(), "workerName" = $2, "updatedAt" = now()
       WHERE id = (
         SELECT id FROM jobs WHERE status = $3 AND "userId" = $4
         ORDER BY "createdAt" ASC LIMIT 1 FOR UPDATE SKIP LOCKED
       )
       RETURNING id`,
      [JobStatus.Claimed, workerName ?? null, JobStatus.Queued, userId],
    );

    const claimedId: number | undefined = rows[0]?.id;
    if (claimedId === undefined) return null;

    return this.jobRepository.findOneBy({ id: claimedId });
  }

  async getSourceFile(id: number, userId: number): Promise<StoredFile> {
    const job = await this.findOwned(id, userId);

    if (job.sourceFileId === null) {
      throw new NotFoundException('The source parcel was already consumed');
    }

    return this.storageService.findOwned(job.sourceFileId, userId);
  }

  async getResultFile(id: number, userId: number): Promise<StoredFile> {
    const job = await this.findOwned(id, userId);

    if (job.resultFileId === null) {
      throw new NotFoundException('This job has no result yet');
    }

    return this.storageService.findOwned(job.resultFileId, userId);
  }

  // Resolves an on-disk path for a StoredFile — kept here rather than
  // making the controller reach into StorageService itself for a single
  // method call.
  filePath(file: StoredFile): string {
    return this.storageService.path(file);
  }

  // Stops a job. A queued job (no worker has it) is cancelled outright. One a
  // worker holds only gets a cancel *request*: the worker polls for it, kills its
  // run and confirms with status 'cancelled' — until then the job is "stopping".
  // `force` skips that wait for a worker that is gone and would never confirm.
  async cancel(id: number, userId: number, force = false): Promise<Job> {
    const job = await this.findOwned(id, userId);

    if (job.status === JobStatus.Cancelled) {
      return job;
    }

    if (job.status === JobStatus.Succeeded || job.status === JobStatus.Failed) {
      throw new ConflictException(
        `Job already ${job.status} — there is nothing to stop`,
      );
    }

    const now = new Date();

    if (job.status === JobStatus.Queued || force) {
      job.status = JobStatus.Cancelled;
      job.finishedAt = now;
      job.cancelRequestedAt = job.cancelRequestedAt ?? now;
      job.logs += `\n[stopped by the owner${force && job.workerName ? ' (forced)' : ''}]\n`;
      this.logJobCancelled(await this.jobRepository.save(job), force);

      return job;
    }

    // Claimed or running: ask the worker. Idempotent — a second click keeps the
    // original request time.
    job.cancelRequestedAt = job.cancelRequestedAt ?? now;

    return this.jobRepository.save(job);
  }

  private logJobCancelled(job: Job, forced: boolean): void {
    void this.appLogs?.record({
      level: 'warn',
      source: 'job',
      event: 'job.cancelled',
      message: `Job ${job.id} was stopped by the owner`,
      meta: { jobId: job.id, model: job.model, forced },
    });
  }

  async updateStatus(
    id: number,
    userId: number,
    dto: UpdateJobStatusDto,
  ): Promise<Job> {
    const job = await this.findOwned(id, userId);

    // A cancelled job is final: a worker that was still winding down must not
    // bring it back to running or turn it into a failure.
    if (job.status === JobStatus.Cancelled) {
      return job;
    }

    // A finished job is final — a late or duplicated report must not
    // overwrite its outcome.
    if (job.status === JobStatus.Succeeded || job.status === JobStatus.Failed) {
      throw new ConflictException(
        `Job is already ${job.status} — its status can no longer change`,
      );
    }

    job.status = dto.status;

    if (dto.status === JobStatus.Running && !job.startedAt) {
      job.startedAt = new Date();
    }

    if (dto.status === JobStatus.Failed) {
      job.errorMessage = dto.errorMessage ?? job.errorMessage;
      job.finishedAt = new Date();
    }

    if (dto.status === JobStatus.Cancelled) {
      job.finishedAt = new Date();
    }

    const saved = await this.jobRepository.save(job);

    if (dto.status === JobStatus.Failed) {
      this.logJobOutcome(saved);
    }

    if (dto.status === JobStatus.Cancelled) {
      this.logJobCancelled(saved, false);
    }

    return saved;
  }

  // One row per finished job — the raw material for success rate, durations
  // and the most common failure reasons. Never awaited for its result.
  private logJobOutcome(job: Job): void {
    const failed = job.status === JobStatus.Failed;
    const durationMs =
      job.startedAt && job.finishedAt
        ? job.finishedAt.getTime() - job.startedAt.getTime()
        : undefined;

    void this.appLogs?.record({
      level: failed ? 'error' : 'info',
      source: 'job',
      event: failed ? 'job.failed' : 'job.succeeded',
      message: failed
        ? `Job ${job.id} failed: ${job.errorMessage ?? 'no error message'}`
        : `Job ${job.id} succeeded`,
      meta: { jobId: job.id, model: job.model, durationMs },
    });
  }

  async appendLog(id: number, userId: number, chunk: string): Promise<void> {
    // One atomic statement: no load (so no decrypting contextText/historyText and no
    // re-reading the whole log), and concurrent flushes cannot overwrite each other.
    const result = await this.jobRepository
      .createQueryBuilder()
      .update(Job)
      .set({
        logs: () => 'logs || :chunk',
        updatedAt: () => 'now()',
      })
      .where('id = :id AND "userId" = :userId', { id, userId })
      .setParameter('chunk', chunk)
      .execute();

    if (!result.affected) {
      throw new NotFoundException('Job not found');
    }
  }

  async setResult(
    id: number,
    userId: number,
    file: Express.Multer.File,
  ): Promise<Job> {
    const job = await this.findOwned(id, userId);

    if (job.status === JobStatus.Cancelled) {
      throw new ConflictException(
        'Job was stopped — its result is not accepted',
      );
    }

    // Null only if a result is reported twice for a job whose pipeline
    // parcel the first report already consumed — the result is then simply
    // stored unaddressed rather than failing the report.
    const sourceFile =
      job.sourceFileId === null
        ? null
        : await this.storageService.findOwned(job.sourceFileId, userId);

    // Propagates the source parcel's own addressing (IMPROVEMENTS_TECH.md
    // 2.3) onto the result, when it had any — lets sync's pull-issue and
    // reports' Subscription find a Worker-job result the same way they'd
    // find agent-runner's own, instead of a Worker job only ever being
    // retrievable through the Worker page. Purely additive: a job run
    // against a plain (non-issue) source still produces an unaddressed
    // result, exactly as before.
    const stored = await this.storageService.create(
      userId,
      file,
      sourceFile?.taskKey
        ? {
            channel: sourceFile.channel ?? undefined,
            taskKey: sourceFile.taskKey,
            direction: StoredFileDirection.Result,
          }
        : {},
    );

    job.resultFileId = stored.id;
    job.status = JobStatus.Succeeded;
    job.finishedAt = new Date();

    // A pipeline parcel (addressed by taskKey) is single-use: once its job
    // has succeeded it has been taken and acted on, so it must not linger in
    // the mailbox. A plain file the user uploaded by hand has no taskKey and
    // is left alone — they may well run it again. Saved first and deleted
    // best-effort after: a failed delete costs some clutter, never a result.
    const consumed = sourceFile?.taskKey ? sourceFile : null;

    if (consumed) {
      job.sourceFileId = null;
    }

    const saved = await this.jobRepository.save(job);

    this.logJobOutcome(saved);

    if (consumed) {
      try {
        await this.storageService.delete(consumed);
      } catch (error) {
        this.logger.warn(
          `Failed to delete consumed source parcel ${consumed.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return saved;
  }
}
