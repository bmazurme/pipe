import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, MoreThan, Repository } from 'typeorm';

import { DeploymentAccessService } from '../auth/deployment-access';
import { DriftService } from '../boards/drift.service';
import {
  ImproveRun,
  ImproveRunStatus,
} from '../improve/entities/improve-run.entity';
import { AppLogService } from '../logs/app-log.service';
import { Job, JobStatus } from '../worker/entities/job.entity';
import { Worker } from '../worker/entities/worker.entity';
import {
  detectIntent,
  type FactsIntent,
  groupAlerts,
  renderBroken,
  renderExplain,
  type RunDetail,
  type SystemSnapshot,
} from './system-facts';

const DAY_MS = 24 * 60 * 60_000;
const WORKER_ONLINE_WITHIN_MS = 10 * 60_000;
const LOG_TAIL_CHARS = 6_000;

export interface RecentRun {
  source: 'improve-run' | 'worker-job';
  id: number;
  status: string;
  model: string;
  title: string;
  at: Date;
}

// A11 — reads the system for the chat. Only the account's owner gets any of it (it is the owner's whole deployment, not one user's data), and nothing
// here writes. Two ways in: a question that is plainly about the system gets the snapshot put in front of the model (works for every model, Claude
// included, with no tool loop), and the same facts are offered as read tools to the models that can call them (ChatToolsController).
@Injectable()
export class ChatSystemFactsService {
  private readonly logger = new Logger(ChatSystemFactsService.name);

  constructor(
    @InjectRepository(ImproveRun)
    private readonly runs: Repository<ImproveRun>,
    @InjectRepository(Job)
    private readonly jobs: Repository<Job>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly appLogs: AppLogService,
    private readonly access: DeploymentAccessService,
    @Optional() private readonly drift?: DriftService,
  ) {}

  isOwner(userId: number): Promise<boolean> {
    return this.access.isOwner(userId);
  }

  // The text to put in front of the model for this message, or null when the message is not about the system (or the person is not the owner).
  async forMessage(userId: number, text: string): Promise<string | null> {
    const intent = detectIntent(text);

    if (!intent || !(await this.isOwner(userId))) return null;

    try {
      return await this.render(userId, intent);
    } catch (error) {
      // A snapshot that could not be taken must not fail the turn: the model answers without it.
      this.logger.warn(
        `System facts for a chat turn failed: ${error instanceof Error ? error.message : String(error)}`,
      );

      return null;
    }
  }

  render(userId: number, intent: FactsIntent): Promise<string> {
    return intent.kind === 'broken'
      ? this.snapshot(userId).then(renderBroken)
      : this.explain(userId, intent.id).then((detail) =>
          renderExplain(intent.id, detail),
        );
  }

  async snapshot(userId: number, now = new Date()): Promise<SystemSnapshot> {
    const since = new Date(now.getTime() - DAY_MS);
    const [
      health,
      logRows,
      failedRuns,
      failedJobs,
      awaitingAnswers,
      workers,
      drift,
    ] = await Promise.all([
      this.health(),
      this.appLogs.list({ levels: ['warn', 'error'], days: 1, limit: 200 }),
      this.runs.find({
        where: {
          userId,
          status: ImproveRunStatus.Failed,
          finishedAt: MoreThan(since),
        },
        order: { finishedAt: 'DESC' },
        take: 10,
      }),
      this.jobs.find({
        where: {
          userId,
          status: JobStatus.Failed,
          finishedAt: MoreThan(since),
        },
        order: { finishedAt: 'DESC' },
        take: 10,
        select: ['id', 'model', 'errorMessage', 'finishedAt', 'taskKey'],
      }),
      this.runs.count({
        where: { userId, status: ImproveRunStatus.AwaitingAnswer },
      }),
      this.workers.find({ where: { userId } }),
      this.drift ? this.drift.view(userId, now).catch(() => null) : null,
    ]);

    return {
      now,
      health,
      alerts: groupAlerts(logRows),
      failedRuns: failedRuns.map((run) => ({
        id: run.id,
        kind: run.kind,
        issueNumber: run.issueNumber,
        title: run.issueTitle,
        model: run.model,
        error: run.error,
        finishedAt: run.finishedAt,
        prNumber: run.prNumber,
      })),
      failedJobs: failedJobs.map((job) => ({
        id: job.id,
        model: job.model,
        error: job.errorMessage,
        finishedAt: job.finishedAt,
        taskKey: job.taskKey,
      })),
      awaitingAnswers,
      drift,
      workers: {
        online: workers
          .filter(
            (w) =>
              w.enabled &&
              w.lastSeenAt !== null &&
              now.getTime() - w.lastSeenAt.getTime() < WORKER_ONLINE_WITHIN_MS,
          )
          .map((w) => w.name),
        offline: workers
          .filter(
            (w) =>
              w.enabled &&
              (w.lastSeenAt === null ||
                now.getTime() - w.lastSeenAt.getTime() >=
                  WORKER_ONLINE_WITHIN_MS),
          )
          .map((w) => w.name),
      },
    };
  }

  // The same number can be an Improve run and a Worker job: both are shown, each under its own heading.
  async explain(userId: number, id: number): Promise<RunDetail> {
    const run = await this.runs.findOne({ where: { id, userId } });
    const jobId = run?.jobId ?? null;
    const [own, linked] = await Promise.all([
      this.jobs.findOne({ where: { id, userId } }),
      jobId !== null && jobId !== id
        ? this.jobs.findOne({ where: { id: jobId, userId } })
        : null,
    ]);
    const job = own ?? linked;

    return {
      run: run && {
        id: run.id,
        kind: run.kind,
        status: run.status,
        trigger: run.trigger,
        model: run.model,
        issueNumber: run.issueNumber,
        title: run.issueTitle,
        prNumber: run.prNumber,
        prUrl: run.prUrl,
        branch: run.branch,
        note: run.note,
        error: run.error,
        gateRetries: run.gateRetries ?? 0,
        escalatedFromRunId: run.escalatedFromRunId ?? null,
        createdAt: run.createdAt,
        finishedAt: run.finishedAt,
        jobId: run.jobId,
      },
      job: job && {
        id: job.id,
        status: job.status,
        model: job.model,
        error: job.errorMessage,
        logs: (job.logs ?? '').slice(-LOG_TAIL_CHARS),
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        costUsd: job.usage?.costUsd ?? null,
      },
      linkedJobId: jobId,
    };
  }

  // Newest first across both kinds, for «what ran lately».
  async recent(
    userId: number,
    limit: number,
    status?: string,
  ): Promise<RecentRun[]> {
    const take = Math.min(Math.max(limit, 1), 30);
    const [runs, jobs] = await Promise.all([
      this.runs.find({
        where: {
          userId,
          ...(status ? { status: status as ImproveRunStatus } : {}),
        },
        order: { id: 'DESC' },
        take,
      }),
      this.jobs.find({
        where: { userId, ...(status ? { status: status as JobStatus } : {}) },
        order: { id: 'DESC' },
        take,
        select: ['id', 'model', 'status', 'createdAt', 'taskKey'],
      }),
    ]);

    return [
      ...runs.map((run): RecentRun => ({
        source: 'improve-run',
        id: run.id,
        status: run.status,
        model: run.model,
        title: run.issueNumber
          ? `issue #${run.issueNumber} ${run.issueTitle}`
          : run.issueTitle,
        at: run.createdAt,
      })),
      ...jobs.map((job): RecentRun => ({
        source: 'worker-job',
        id: job.id,
        status: job.status,
        model: job.model,
        title: job.taskKey ?? '',
        at: job.createdAt,
      })),
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, take);
  }

  private async health(): Promise<{
    database: boolean;
    pendingMigrations: boolean;
  }> {
    try {
      await this.dataSource.query('SELECT 1');

      return {
        database: true,
        pendingMigrations: await this.dataSource.showMigrations(),
      };
    } catch {
      return { database: false, pendingMigrations: true };
    }
  }
}

// Used by the claim handler to know the last thing the person said.
export function lastUserMessage(
  history: Array<{ role: string; content: string }>,
): string {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'user') return history[i].content;
  }

  return '';
}
