import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThan, Not, Repository } from 'typeorm';

import { BoardsService } from '../boards/boards.service';
import {
  ImproveRun,
  ImproveRunStatus,
} from '../improve/entities/improve-run.entity';
import { GithubApiService } from '../loop/github-api.service';
import { QuestionsService } from '../questions/questions.service';
import { Job, JobStatus } from '../worker/entities/job.entity';
import { Worker } from '../worker/entities/worker.entity';
import { STALE_AFTER_MS } from '../worker/worker-heartbeat.service';
import {
  buildInbox,
  InboxFacts,
  InboxItem,
  InboxPull,
  InboxWorker,
} from './inbox';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PULLS = 10;
const MAX_FAILED_JOBS = 20;
// GitHub is asked live for each open PR; the answer is reused briefly so a page that refreshes every half minute costs one round of calls.
const PULL_CACHE_MS = 60_000;

interface CachedPull {
  at: number;
  ci: InboxPull['ci'];
  open: boolean;
}

@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);
  private readonly pullCache = new Map<number, CachedPull>();

  constructor(
    @InjectRepository(ImproveRun)
    private readonly runs: Repository<ImproveRun>,
    @InjectRepository(Job)
    private readonly jobs: Repository<Job>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    private readonly questions: QuestionsService,
    private readonly boards: BoardsService,
    private readonly github: GithubApiService,
  ) {}

  async list(userId: number, now = new Date()): Promise<InboxItem[]> {
    // Each source fails on its own: a GitHub outage must not hide the unanswered questions.
    const [pulls, cards, boards, workers, failedJobs] = await Promise.all([
      this.safe('pulls', () => this.pulls(userId, now), []),
      this.safe('questions', () => this.questions.listCards(userId, false), []),
      this.safe('boards', () => this.boards.list(userId), []),
      this.safe('workers', () => this.workerFacts(userId, now), []),
      this.safe('jobs', () => this.failedJobs(userId, now), []),
    ]);
    const open = cards.filter((card) => card.openCount > 0);
    const facts: InboxFacts = {
      pulls,
      openQuestions: open.reduce((sum, card) => sum + card.openCount, 0),
      openQuestionCards: open.length,
      oldestQuestionAt:
        open
          .flatMap((card) =>
            card.questions
              .filter((question) => !question.resolved)
              .map((question) => new Date(question.createdAt).toISOString()),
          )
          .sort()[0] ?? null,
      boards: boards.map((board) => ({
        host: board.host,
        online: board.online,
        reportedAt: new Date(board.reportedAt).toISOString(),
        outdated: board.outdated,
        updatable: board.updatable,
        warnings: (board as unknown as { warnings?: string[] }).warnings ?? [],
      })),
      workers,
      failedJobs,
      now,
    };

    return buildInbox(facts);
  }

  private async safe<T>(
    what: string,
    run: () => Promise<T>,
    fallback: T,
  ): Promise<T> {
    try {
      return await run();
    } catch (error) {
      this.logger.warn(
        `Inbox: ${what} unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );

      return fallback;
    }
  }

  // The open pull requests Improve made. CI state comes from GitHub (cached for a minute); a PR that was merged or closed meanwhile is dropped.
  private async pulls(userId: number, now: Date): Promise<InboxPull[]> {
    const runs = await this.runs.find({
      where: {
        userId,
        kind: 'issue',
        status: ImproveRunStatus.PrOpen,
        prNumber: Not(IsNull()),
      },
      order: { id: 'DESC' },
      take: MAX_PULLS,
    });
    const pulls = await Promise.all(
      runs.map(async (run): Promise<InboxPull | null> => {
        const number = run.prNumber as number;
        const base = {
          number,
          title: run.issueTitle,
          url: run.prUrl,
          openedAt: (run.finishedAt ?? run.createdAt)?.toISOString() ?? null,
        };

        if (!this.github.isReady()) return { ...base, ci: 'unknown' };

        const cached = this.pullCache.get(number);

        if (cached && now.getTime() - cached.at < PULL_CACHE_MS) {
          return cached.open ? { ...base, ci: cached.ci } : null;
        }

        try {
          const pull = await this.github.getPull(number);
          const open = pull.state === 'open' && !pull.merged;
          const ci = open ? await this.github.ciState(pull.headSha) : 'none';

          this.pullCache.set(number, { at: now.getTime(), ci, open });

          return open ? { ...base, ci } : null;
        } catch {
          return { ...base, ci: 'unknown' };
        }
      }),
    );

    return pulls.filter((pull): pull is InboxPull => pull !== null);
  }

  private async workerFacts(userId: number, now: Date): Promise<InboxWorker[]> {
    const rows = await this.workers.find({ where: { userId } });

    return rows.map((worker) => {
      const limits = worker.claudeLimits;
      // A window whose reset time has passed is no longer a problem, whatever the old snapshot says.
      const live = Object.values(limits?.windows ?? {}).filter(
        (window) =>
          window.resetsAt === null || window.resetsAt * 1000 > now.getTime(),
      );

      return {
        name: worker.name,
        enabled: worker.enabled,
        online:
          worker.lastSeenAt !== null &&
          now.getTime() - worker.lastSeenAt.getTime() < STALE_AFTER_MS,
        lastSeenAt: worker.lastSeenAt?.toISOString() ?? null,
        limitUtilization: live.length
          ? Math.max(...live.map((window) => window.utilization))
          : null,
        limitStatus:
          limits?.status === 'rejected' && live.length > 0 ? 'rejected' : null,
      };
    });
  }

  // Failed in the last day and not since followed by a success for the same task — a retry that worked is not news.
  private async failedJobs(userId: number, now: Date) {
    const since = new Date(now.getTime() - DAY_MS);
    const failed = await this.jobs.find({
      where: { userId, status: JobStatus.Failed, updatedAt: MoreThan(since) },
      order: { updatedAt: 'DESC' },
      take: MAX_FAILED_JOBS,
    });
    const keys = [
      ...new Set(failed.map((job) => job.taskKey).filter(Boolean)),
    ] as string[];
    const recovered = keys.length
      ? await this.jobs.find({
          where: {
            userId,
            status: JobStatus.Succeeded,
            taskKey: In(keys),
            updatedAt: MoreThan(since),
          },
          select: { id: true, taskKey: true, updatedAt: true },
        })
      : [];

    return failed
      .filter(
        (job) =>
          !recovered.some(
            (ok) => ok.taskKey === job.taskKey && ok.updatedAt > job.updatedAt,
          ),
      )
      .map((job) => ({
        id: job.id,
        taskKey: job.taskKey ?? null,
        model: job.model,
        error: job.errorMessage,
        at: job.updatedAt.toISOString(),
      }));
  }
}
