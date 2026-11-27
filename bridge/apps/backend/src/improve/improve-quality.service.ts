import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';

import { GithubApiService } from '../loop/github-api.service';
import { Job } from '../worker/entities/job.entity';
import {
  type FirstCi,
  ImproveOutcome,
} from './entities/improve-outcome.entity';
import { ImproveRun } from './entities/improve-run.entity';
import {
  needsRefresh,
  type OutcomeRow,
  type QualityView,
  revertedPrNumbers,
  summarizeQuality,
} from './quality';

const SYNC_EVERY_MS = 30 * 60_000;
// Each pull request costs two or three GitHub calls; the backlog drains over several syncs instead of one burst.
const PER_SYNC = 40;
const STALE_AFTER_MS = 15 * 60_000;

export interface QualitySyncResult {
  checked: number;
  remaining: number;
}

@Injectable()
export class ImproveQualityService {
  private readonly logger = new Logger(ImproveQualityService.name);
  private syncing = false;
  private lastSyncAt = 0;

  constructor(
    @InjectRepository(ImproveRun)
    private readonly runs: Repository<ImproveRun>,
    @InjectRepository(ImproveOutcome)
    private readonly outcomes: Repository<ImproveOutcome>,
    @InjectRepository(Job)
    private readonly jobs: Repository<Job>,
    private readonly github: GithubApiService,
  ) {}

  // The figures. A sync that is overdue is started in the background, so the page is never held up by GitHub and still gets better on its own.
  async summary(userId: number, days: number): Promise<QualityView> {
    if (Date.now() - this.lastSyncAt > STALE_AFTER_MS) {
      void this.sync(userId).catch((error: unknown) =>
        this.logger.warn(
          `Quality sync failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }

    const rows = await this.outcomes.find({ where: { userId } });

    return summarizeQuality(rows as OutcomeRow[], days);
  }

  @Interval(SYNC_EVERY_MS)
  async tick(): Promise<void> {
    if (!this.github.isConfigured()) return;

    try {
      const users = await this.runs
        .createQueryBuilder('run')
        .select('DISTINCT run.userId', 'userId')
        .where('run.prNumber IS NOT NULL')
        .getRawMany<{ userId: number }>();

      for (const { userId } of users) await this.sync(Number(userId));
    } catch (error) {
      this.logger.warn(
        `Quality sync failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Looks at the pull requests whose outcome can still change (never-seen ones, open ones, ones merged in the last week), at most PER_SYNC of them.
  async sync(userId: number, now = new Date()): Promise<QualitySyncResult> {
    if (!this.github.isConfigured() || this.syncing) {
      return { checked: 0, remaining: 0 };
    }

    this.syncing = true;

    try {
      const runs = await this.runs.find({
        where: { userId, prNumber: Not(IsNull()) },
        order: { id: 'ASC' },
      });
      const byPr = new Map<number, ImproveRun[]>();

      for (const run of runs) {
        const prNumber = run.prNumber as number;

        byPr.set(prNumber, [...(byPr.get(prNumber) ?? []), run]);
      }

      const known = new Map(
        (await this.outcomes.find({ where: { userId } })).map((row) => [
          row.prNumber,
          row,
        ]),
      );
      // Never-seen first (so a new pull request shows up at once), then the oldest check.
      const todo = [...byPr.keys()]
        .filter((pr) => {
          const row = known.get(pr);

          return !row || needsRefresh(row, now);
        })
        .sort(
          (a, b) =>
            (known.get(a)?.checkedAt.getTime() ?? 0) -
            (known.get(b)?.checkedAt.getTime() ?? 0),
        );
      const batch = todo.slice(0, PER_SYNC);
      let reverted: Set<number> | null = null;
      let checked = 0;

      for (const prNumber of batch) {
        try {
          reverted ??= revertedPrNumbers(
            await this.github.recentMergedTitles(100),
          );
          await this.refresh(
            userId,
            prNumber,
            byPr.get(prNumber) as ImproveRun[],
            known.get(prNumber) ?? null,
            reverted,
            now,
          );
          checked += 1;
        } catch (error) {
          this.logger.warn(
            `Quality: PR #${prNumber} not read: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      this.lastSyncAt = Date.now();

      return { checked, remaining: Math.max(0, todo.length - batch.length) };
    } finally {
      this.syncing = false;
    }
  }

  private async refresh(
    userId: number,
    prNumber: number,
    runs: ImproveRun[],
    existing: ImproveOutcome | null,
    reverted: Set<number>,
    now: Date,
  ): Promise<void> {
    const root = runs.find((run) => run.kind === 'issue') ?? runs[0];
    const times = await this.github.pullTimes(prNumber);
    let firstCi: FirstCi | null = existing?.firstCi ?? null;

    if (firstCi === null) {
      const sha = await this.github.firstCommitSha(prNumber);
      const state = sha ? await this.github.ciState(sha) : 'none';

      // A run that is still going says nothing yet; it is asked again at the next sync.
      firstCi = state === 'pending' ? null : state;
    }

    const jobIds = runs
      .map((run) => run.jobId)
      .filter((id): id is number => id !== null);
    const jobs = jobIds.length
      ? await this.jobs.find({ where: { id: In(jobIds) } })
      : [];
    const costs = jobs
      .map((job) => job.usage?.costUsd)
      .filter((cost): cost is number => typeof cost === 'number');

    await this.outcomes.upsert(
      {
        userId,
        prNumber,
        runId: root.id,
        model: root.model,
        tier: root.routing?.tier ?? null,
        state: times.merged ? 'merged' : times.open ? 'open' : 'closed',
        firstCi,
        ciRepairs: runs.filter(
          (run) => run.kind === 'repair' && run.trigger === 'ci',
        ).length,
        costUsd: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
        openedAt: new Date(times.createdAt),
        mergedAt: times.mergedAt ? new Date(times.mergedAt) : null,
        closedAt: times.closedAt ? new Date(times.closedAt) : null,
        reverted: reverted.has(prNumber),
        checkedAt: now,
      },
      ['userId', 'prNumber'],
    );
  }
}
