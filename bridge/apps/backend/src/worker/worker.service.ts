import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThan, Not, Repository } from 'typeorm';

import { DeploymentAccessService } from '../auth/deployment-access';
import { ContextService } from '../context/context.service';
import { AppLogService } from '../logs/app-log.service';
import { NotifyService } from '../telegram/notify.service';
import { StorageService } from '../storage/storage.service';
import {
  StoredFile,
  StoredFileDirection,
} from '../storage/entities/stored-file.entity';
import {
  type ClaudeLimits,
  sanitizeLimits,
  sanitizeUsage,
} from './claude-limits';
import { ClaudeCredentialsService } from './claude-credentials.service';
import { CreateJobDto } from './dto/create-job.dto';
import { ReportUsageDto } from './dto/report-usage.dto';
import { UpdateJobStatusDto } from './dto/update-job-status.dto';
import { Job, JobStatus } from './entities/job.entity';
import { INFRA_FAILURE_MESSAGES } from './infra-failure';
import { logJobOutcome } from './job-outcome-log';
import { JobSweepService } from './job-sweep.service';
import { Worker } from './entities/worker.entity';
import {
  isProviderModel,
  ProviderCredentialsService,
} from './provider-credentials.service';
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

export type JobStatusRow = Pick<
  Job,
  'id' | 'userId' | 'status' | 'resultFileId' | 'errorMessage'
>;

// What a Claude run that Anthropic refused prints (e.g. "Failed to authenticate. API Error: 403 Request not allowed").
const AUTH_FAILURE_PATTERN =
  /Failed to authenticate|\b401\b|\b403\b.*Request not allowed/i;

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
    @InjectRepository(Worker)
    private readonly workerRepository: Repository<Worker>,
    private readonly providerCredentialsService: ProviderCredentialsService,
    private readonly jobSweep: JobSweepService,
    @Optional() private readonly appLogs?: AppLogService,
    @Optional() private readonly notifyService?: NotifyService,
    @Optional() private readonly deploymentAccess?: DeploymentAccessService,
  ) {
    this.jobSweep.onJobsLost = async (jobs) => {
      for (const job of jobs) {
        await this.retryAfterInfraFailure(job);
      }
    };
  }

  // Opt-in, per job: one Telegram message when a job ends. Telegram has a single recipient,
  // so only the deployment owner's flag counts. Best-effort — never changes the outcome.
  private async notifyFinished(job: Job): Promise<void> {
    if (!job.notifyOnFinish || !this.notifyService || !this.deploymentAccess) {
      return;
    }

    try {
      if (!(await this.deploymentAccess.isOwner(job.userId))) return;

      const text =
        job.status === JobStatus.Succeeded
          ? `✅ Задача #${job.id} (${job.model}) завершена`
          : `🔴 Задача #${job.id} (${job.model}) не выполнена: ${(job.errorMessage ?? '').slice(0, 200)}`;

      await this.notifyService.send(text);
    } catch (error) {
      this.logger.warn(
        `Failed to notify about job ${job.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private isInfraFailure(job: Job): boolean {
    if (job.failureKind) return true;

    // Legacy fallback for workers that do not send failureKind yet.
    // TODO: remove once every worker is upgraded.
    return (
      job.errorMessage !== null &&
      INFRA_FAILURE_MESSAGES.includes(job.errorMessage)
    );
  }

  // A job lost to a worker stop/restart says nothing about the task, so it is queued
  // once more automatically — but only once per parcel (an earlier infrastructure
  // failure on the same parcel means this already was the retry), so a crash-looping
  // worker cannot requeue forever. Never throws; returns the new job, if any.
  async retryAfterInfraFailure(job: Job): Promise<Job | null> {
    if (
      job.status !== JobStatus.Failed ||
      job.sourceFileId === null ||
      !this.isInfraFailure(job)
    ) {
      return null;
    }

    try {
      const earlier = await this.jobRepository.count({
        where: [
          {
            sourceFileId: job.sourceFileId,
            failureKind: Not(IsNull()),
            id: Not(job.id),
          },
          // Legacy fallback for workers that do not send failureKind yet.
          // TODO: remove once every worker is upgraded.
          {
            sourceFileId: job.sourceFileId,
            errorMessage: In(INFRA_FAILURE_MESSAGES),
            id: Not(job.id),
          },
        ],
      });

      if (earlier > 0) return null;

      const retried = await this.retry(job.id, job.userId);

      void this.appLogs?.record({
        level: 'info',
        source: 'job',
        event: 'job.auto_retried',
        message: `Job ${job.id} was lost to a worker stop and re-queued as job ${retried.id}`,
        meta: { jobId: job.id, retryJobId: retried.id, model: job.model },
      });

      return retried;
    } catch (error) {
      this.logger.warn(
        `Automatic retry of job ${job.id} skipped: ${error instanceof Error ? error.message : String(error)}`,
      );

      return null;
    }
  }

  // Outbound "issue" parcels of one account that no job has picked up yet: unencrypted
  // (the only kind create() accepts), created on/after `since` and at least
  // `minAgeSeconds` ago (so a parcel still being uploaded is left alone). Parcels whose
  // task key starts with `excludeTaskKeyPrefix` are skipped.
  findUnstartedIssueParcels(
    userId: number,
    since: Date,
    minAgeSeconds: number,
    excludeTaskKeyPrefix?: string,
  ): Promise<StoredFile[]> {
    const query = this.jobRepository.manager
      .createQueryBuilder(StoredFile, 'f')
      .where('f.userId = :userId', { userId })
      .andWhere('f.createdAt >= :since', { since })
      .andWhere('f.createdAt < :cutoff', {
        cutoff: new Date(Date.now() - minAgeSeconds * 1000),
      })
      .andWhere('f.channel = :channel', { channel: 'issue' })
      .andWhere('f.direction = :direction', {
        direction: StoredFileDirection.Outbound,
      })
      .andWhere('f.originalName NOT LIKE :encrypted', {
        encrypted: `%${ENCRYPTED_SUFFIX}`,
      })
      .andWhere(
        (qb) =>
          `NOT EXISTS ${qb
            .subQuery()
            .select('1')
            .from(Job, 'j')
            .where('j.sourceFileId = f.id')
            .getQuery()}`,
      );

    if (excludeTaskKeyPrefix !== undefined) {
      query.andWhere('f.taskKey NOT LIKE :excludedTasks', {
        excludedTasks: `${excludeTaskKeyPrefix}%`,
      });
    }

    return query.orderBy('f.id', 'ASC').getMany();
  }

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

    if (dto.providerCredentialId !== undefined) {
      if (
        !isProviderModel(dto.model) ||
        !(await this.providerCredentialsService.existsFor(
          dto.providerCredentialId,
          userId,
          dto.model,
        ))
      ) {
        throw new BadRequestException(
          'Provider credential not found for this model',
        );
      }
    }

    // Pinned to one worker: it must be the owner's, switched on, and allowed to run this model — otherwise the job
    // would sit in the queue for ever. Not pinned (the default) = whichever suitable worker is free first.
    if (dto.targetWorkerId !== undefined) {
      const target = await this.workerRepository.findOneBy({
        id: dto.targetWorkerId,
        userId,
      });

      if (!target) {
        throw new BadRequestException('Worker not found');
      }
      if (!target.enabled) {
        throw new BadRequestException(`Worker "${target.name}" is paused`);
      }
      if (target.models !== null && !target.models.includes(dto.model)) {
        throw new BadRequestException(
          `Worker "${target.name}" is not set up to run ${dto.model}`,
        );
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
      providerCredentialId: dto.providerCredentialId ?? null,
      targetWorkerId: dto.targetWorkerId ?? null,
      notifyOnFinish: dto.notifyOnFinish === true,
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

    // The pin only while that worker is still there, switched on and allowed to run the model; otherwise any free one.
    const pinned =
      job.targetWorkerId !== null
        ? await this.workerRepository.findOneBy({
            id: job.targetWorkerId,
            userId,
            enabled: true,
          })
        : null;
    const pinUsable =
      pinned !== null &&
      (pinned.models === null || pinned.models.includes(job.model));
    const retried = await this.create(
      userId,
      {
        sourceFileId: job.sourceFileId,
        model: job.model,
        ...(job.claudeCredentialId !== null
          ? { claudeCredentialId: job.claudeCredentialId }
          : {}),
        ...(job.providerCredentialId !== null
          ? { providerCredentialId: job.providerCredentialId }
          : {}),
        ...(pinUsable ? { targetWorkerId: pinned.id } : {}),
        ...(job.notifyOnFinish ? { notifyOnFinish: true } : {}),
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

  // `updatedAfter` lets the frontend poll for only what changed since its last fetch instead of
  // the whole (ever-growing) history every few seconds — it merges the delta into what it already
  // has (see workerApi's listJobs). A job's `updatedAt` is bumped on every status/log/usage write
  // (plain .save()/.update() do this automatically; the few raw UPDATEs set it explicitly), so
  // nothing that changed can be missed; a hard-deleted job is handled by the frontend removing it
  // from its cache directly on delete, since a row that no longer exists can't appear in any filter.
  async findAllByUser(userId: number, updatedAfter?: Date): Promise<Job[]> {
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
      where: {
        userId,
        ...(updatedAfter ? { updatedAt: MoreThan(updatedAfter) } : {}),
      },
      order: { createdAt: 'DESC' },
    });
  }

  // Only the fields a status follower needs, for many jobs in one query: no logs, no
  // context/history text. The caller checks `userId` against its own owner.
  async findStatuses(ids: number[]): Promise<JobStatusRow[]> {
    if (ids.length === 0) return [];

    return this.jobRepository.find({
      where: { id: In(ids) },
      select: ['id', 'userId', 'status', 'resultFileId', 'errorMessage'],
    });
  }

  // The newest job started over the same parcel after each of the given ones — what the Worker page's
  // "retry" creates (a new job, the old one stays as history). Keyed by the old job's id.
  async findRetriesOf(ids: number[]): Promise<Map<number, JobStatusRow>> {
    const retries = new Map<number, JobStatusRow>();

    if (ids.length === 0) return retries;

    const olds = await this.jobRepository.find({
      where: { id: In(ids) },
      select: ['id', 'userId', 'sourceFileId'],
    });
    const sources = olds.flatMap((job) =>
      job.sourceFileId === null ? [] : [job.sourceFileId],
    );

    if (sources.length === 0) return retries;

    const candidates = await this.jobRepository.find({
      where: { sourceFileId: In(sources) },
      select: [
        'id',
        'userId',
        'status',
        'resultFileId',
        'errorMessage',
        'sourceFileId',
      ],
      order: { id: 'DESC' },
    });

    for (const old of olds) {
      const newer = candidates.find(
        (job) =>
          job.sourceFileId === old.sourceFileId &&
          job.userId === old.userId &&
          job.id > old.id,
      );

      if (newer) retries.set(old.id, newer);
    }

    return retries;
  }

  async findOwned(id: number, userId: number): Promise<Job> {
    const job = await this.jobRepository.findOne({ where: { id, userId } });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    return job;
  }

  // The job dialog's poll: the same job GET :id returns, but only the log characters
  // after the first `logsFrom` ones, plus the whole log's length (so the caller can tell
  // when it shrank). Both are counted by Postgres in characters, not bytes. Skips the
  // context/history text (and so their decryption), which GET :id never returns anyway.
  async findOwnedWithLogsFrom(
    id: number,
    userId: number,
    logsFrom: number,
  ): Promise<{ job: Job; logsTail: string; logsLength: number }> {
    const columns = this.jobRepository.metadata.columns
      .map((column) => column.propertyName)
      .filter(
        (name) =>
          name !== 'logs' && name !== 'contextText' && name !== 'historyText',
      );

    // CAST: an untyped parameter would make SUBSTRING(... FROM $n) pick the regex form.
    const { entities, raw } = await this.jobRepository
      .createQueryBuilder('job')
      .select(columns.map((name) => `job.${name}`))
      .addSelect(
        `SUBSTRING(COALESCE("job"."logs", '') FROM CAST(:logsStart AS integer))`,
        'logsTail',
      )
      .addSelect(`CHAR_LENGTH(COALESCE("job"."logs", ''))`, 'logsLength')
      .where('"job"."id" = :id AND "job"."userId" = :userId', {
        id,
        userId,
      })
      .setParameter('logsStart', logsFrom + 1)
      .getRawAndEntities<{ logsTail: string | null; logsLength: number }>();

    if (entities.length === 0) {
      throw new NotFoundException('Job not found');
    }

    return {
      job: entities[0],
      logsTail: raw[0]?.logsTail ?? '',
      logsLength: Number(raw[0]?.logsLength ?? 0),
    };
  }

  // Polled by the worker every few seconds while a job runs, so it reads only the
  // columns it answers with — never the unbounded `logs` or the context/history text.
  async getCancelState(
    id: number,
    userId: number,
  ): Promise<Pick<Job, 'id' | 'status' | 'cancelRequestedAt'>> {
    const job = await this.jobRepository.findOne({
      select: { id: true, status: true, cancelRequestedAt: true },
      where: { id, userId },
    });

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
  // `workerId` is set when the caller is a worker added in the UI (it authenticates with its own key); a worker on a
  // personal API key has none and is known only by the name it reports. Who may take what:
  //  - a managed worker: only while switched on, only the models it is set up for, jobs pinned to it or not pinned at
  //    all, and only one job at a time;
  //  - a legacy worker: only jobs that are not pinned to a specific worker.
  async claim(
    userId: number,
    workerName?: string,
    workerId?: number,
  ): Promise<Job | null> {
    let name = workerName;
    let worker: Worker | null = null;

    if (workerId !== undefined) {
      worker = await this.workerRepository.findOneBy({ id: workerId, userId });

      // A deleted worker's key no longer authenticates, so this is only a race with its deletion.
      if (!worker) return null;

      name = worker.name;
      await this.workerRepository.update(worker.id, { lastSeenAt: new Date() });

      // It is asking for work, so it is idle: whatever it still "holds" is lost (the process was restarted).
      // Immediately — unlike a legacy name, a key belongs to exactly one process.
      await this.jobSweep.sweepManagedWorker(userId, worker.id);

      if (!worker.enabled) return null;
    } else if (workerName) {
      // Recorded unconditionally — this is the actual liveness signal (see
      // WorkerHeartbeatService): a worker polling an empty queue still proves
      // it's alive here even though nothing below changes a single Job row.
      await this.heartbeatService.record(userId, workerName);
      await this.jobSweep.sweepOrphansFor(userId, workerName);
    }

    // node-postgres's driver (via TypeORM's Repository.query) returns
    // [rows, affectedCount] for an UPDATE/INSERT/DELETE — even one with a
    // RETURNING clause — not a flat rows array the way a plain SELECT does.
    // Indexing straight into the result ([0]?.id) silently reads the rows
    // array itself as if it were the first row, always finding no `.id` and
    // reporting "nothing to claim" even though the UPDATE just committed.
    const params: unknown[] = [
      JobStatus.Claimed,
      name ?? null,
      JobStatus.Queued,
      userId,
      worker?.id ?? null,
    ];
    let eligibility = ' AND "targetWorkerId" IS NULL';

    if (worker) {
      eligibility = ' AND ("targetWorkerId" IS NULL OR "targetWorkerId" = $5)';

      if (worker.models !== null) {
        params.push(worker.models);
        eligibility += ` AND model::text = ANY($${params.length}::text[])`;
      }
    }

    const [rows]: [{ id: number }[], number] = await this.jobRepository.query(
      `UPDATE jobs SET status = $1, "claimedAt" = now(), "workerName" = $2, "workerId" = $5, "updatedAt" = now()
       WHERE id = (
         SELECT id FROM jobs WHERE status = $3 AND "userId" = $4${eligibility}
         ORDER BY "createdAt" ASC LIMIT 1 FOR UPDATE SKIP LOCKED
       )
       RETURNING id`,
      params,
    );

    const claimedId: number | undefined = rows[0]?.id;
    if (claimedId === undefined) return null;

    return this.jobRepository.findOneBy({ id: claimedId });
  }

  // A worker added in the UI may only touch the jobs it holds (a personal API key keeps its account-wide reach).
  // What a worker reports after a Claude run: the plan limits (kept on the worker and, for a job on a named
  // token, on that token) and the job's tokens and cost. Everything is checked on the way in; garbage is dropped.
  async recordClaudeReport(
    userId: number,
    workerId: number | undefined,
    dto: ReportUsageDto,
    now = new Date(),
  ): Promise<{ limits: ClaudeLimits; credentialId: number | null } | null> {
    const limits = sanitizeLimits(dto.limits, now);
    const usage = sanitizeUsage(dto.usage);

    if (limits && workerId !== undefined) {
      await this.workerRepository.update(
        { id: workerId, userId },
        { claudeLimits: limits },
      );
    }

    if (dto.jobId === undefined) {
      if (!limits) return null;

      // A probe runs on the token the worker's jobs use (its own, else the account's first): the limits are that token's.
      if (dto.probe === true && workerId !== undefined) {
        const worker = await this.workerRepository.findOneBy({
          id: workerId,
          userId,
        });
        const token = await this.claudeCredentialsService.resolveForRun(
          userId,
          null,
          worker?.claudeCredentialId ?? null,
        );

        if (token) {
          await this.claudeCredentialsService.recordLimits(
            token.id,
            userId,
            limits,
          );
          await this.claudeCredentialsService.clearAuthFailed(token.id, userId);

          return { limits, credentialId: token.id };
        }
      }

      return { limits, credentialId: null };
    }

    await this.assertHeldBy(dto.jobId, userId, workerId);

    const job = await this.findOwned(dto.jobId, userId);

    if (usage) await this.jobRepository.update(job.id, { usage });

    const limitsCredentialId =
      job.claudeCredentialId ?? job.usedClaudeCredentialId ?? null;

    if (limits && limitsCredentialId !== null) {
      await this.claudeCredentialsService.recordLimits(
        limitsCredentialId,
        userId,
        limits,
      );
    }

    // Usage or limits only arrive from a run Anthropic accepted.
    if ((limits || usage) && limitsCredentialId !== null) {
      await this.claudeCredentialsService.clearAuthFailed(
        limitsCredentialId,
        userId,
      );
    }

    return limits ? { limits, credentialId: limitsCredentialId } : null;
  }

  async recordUsedCredential(
    jobId: number,
    userId: number,
    credentialId: number,
  ): Promise<void> {
    await this.jobRepository.update(jobId, {
      usedClaudeCredentialId: credentialId,
      usedClaudeCredentialName: await this.claudeCredentialsService.nameOf(
        credentialId,
        userId,
      ),
    });
  }

  async assertHeldBy(
    id: number,
    userId: number,
    workerId: number | undefined,
  ): Promise<void> {
    if (workerId === undefined) return;

    const job = await this.findOwned(id, userId);

    if (job.workerId !== workerId) {
      throw new ForbiddenException('This job is not held by this worker');
    }
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

  // Sends a StoredFile to the client — kept here rather than making the controller reach into StorageService
  // itself for a single method call. `done` is res.download()'s callback.
  download(res: Response, file: StoredFile, done: (error?: Error) => void) {
    this.storageService.download(res, file, done);
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

    if (job.status === JobStatus.Queued || force) {
      const suffix = `\n[stopped by the owner${force && job.workerName ? ' (forced)' : ''}]\n`;

      // One conditional statement instead of load + save: a log chunk the worker
      // appended meanwhile is kept, and a job it just finished is never overwritten.
      // (Raw query result is [rows, affectedCount] — see claim().)
      const [rows]: [Job[], number] = await this.jobRepository.query(
        `UPDATE jobs SET status = $1, "finishedAt" = now(),
           "cancelRequestedAt" = COALESCE("cancelRequestedAt", now()),
           logs = COALESCE(logs, '') || $2, "updatedAt" = now()
         WHERE id = $3 AND "userId" = $4 AND status IN ($5, $6, $7)
         RETURNING *`,
        [
          JobStatus.Cancelled,
          suffix,
          id,
          userId,
          JobStatus.Queued,
          JobStatus.Claimed,
          JobStatus.Running,
        ],
      );

      if (rows.length > 0) {
        this.logJobCancelled(rows[0], force);

        return rows[0];
      }

      // Nothing matched: the job reached a final state since we loaded it.
      const current = await this.findOwned(id, userId);

      if (current.status === JobStatus.Cancelled) {
        return current;
      }

      throw new ConflictException(
        `Job already ${current.status} — there is nothing to stop`,
      );
    }

    // Claimed or running: ask the worker. Idempotent — a second click keeps the
    // original request time.
    await this.jobRepository
      .createQueryBuilder()
      .update(Job)
      .set({ cancelRequestedAt: () => 'COALESCE("cancelRequestedAt", now())' })
      .where('id = :id AND "userId" = :userId', { id, userId })
      .execute();

    return this.findOwned(id, userId);
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
      job.failureKind = dto.failureKind ?? job.failureKind ?? null;
      job.finishedAt = new Date();
    }

    if (dto.status === JobStatus.Cancelled) {
      job.finishedAt = new Date();
    }

    const saved = await this.jobRepository.save(job);

    if (
      dto.status === JobStatus.Failed &&
      saved.usedClaudeCredentialId != null &&
      AUTH_FAILURE_PATTERN.test(saved.errorMessage ?? '')
    ) {
      await this.claudeCredentialsService.markAuthFailed(
        saved.usedClaudeCredentialId,
        userId,
        saved.id,
      );
    }

    if (
      dto.status === JobStatus.Succeeded &&
      saved.usedClaudeCredentialId != null
    ) {
      await this.claudeCredentialsService.clearAuthFailed(
        saved.usedClaudeCredentialId,
        userId,
      );
    }

    if (dto.status === JobStatus.Failed) {
      logJobOutcome(this.appLogs, saved);
      const requeued = await this.retryAfterInfraFailure(saved);

      if (!requeued) {
        await this.notifyFinished(saved);
      }
    }

    if (dto.status === JobStatus.Cancelled) {
      this.logJobCancelled(saved, false);
    }

    return saved;
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

    logJobOutcome(this.appLogs, saved);
    await this.notifyFinished(saved);

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
