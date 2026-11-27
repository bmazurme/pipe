import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';

import { LoopControlService } from '../loop/loop-control.service';
import { NotifyService } from '../telegram/notify.service';
import { Job } from '../worker/entities/job.entity';
import {
  decideEscalation,
  describeSkip,
  EscalationDecision,
  escalationFromSettings,
  EscalationSettings,
  escalationNote,
  isStepUp,
} from './escalation';
import { ImproveRun, ImproveRunStatus } from './entities/improve-run.entity';
import { ImproveSettings } from './entities/improve-settings.entity';
import { ImproveService } from './improve.service';

const SWEEP_EVERY_MS = 60_000;
// A failure older than this is not picked up any more: the owner has long since looked at it, and a stronger model started hours later is a surprise.
const MAX_FAILURE_AGE_MS = 6 * 60 * 60_000;
const MAX_PER_SWEEP = 10;
const DAY_MS = 24 * 60 * 60_000;

// A9 — the ladder of models, in action. Two things send work one step up (haiku → sonnet → opus), once each:
//  - an issue run that FAILED for a reason that is the task's (ImproveRun.failureCause, set where the failure is recorded) → the same issue again;
//  - a pull request whose CI is still red after the automatic repairs → one more repair, on the stronger model (called by ImproveCiService).
// Both are refused, with the reason told to the owner, once the task or the last 24 hours have cost more than the account's limits. Off by default.
@Injectable()
export class ImproveEscalationService {
  private readonly logger = new Logger(ImproveEscalationService.name);
  private sweeping = false;

  constructor(
    @InjectRepository(ImproveRun)
    private readonly runs: Repository<ImproveRun>,
    @InjectRepository(ImproveSettings)
    private readonly settings: Repository<ImproveSettings>,
    @InjectRepository(Job)
    private readonly jobs: Repository<Job>,
    private readonly improve: ImproveService,
    private readonly notifier: NotifyService,
    @Optional() private readonly control?: LoopControlService,
  ) {}

  async settingsFor(userId: number): Promise<EscalationSettings> {
    return escalationFromSettings(
      await this.settings.findOne({ where: { userId } }),
    );
  }

  // What the Improve jobs of one task, and of the last 24 hours, have cost (the Claude CLI's own figure, API-price equivalent); a job that reported none
  // counts for nothing, so this is a floor.
  async spend(
    userId: number,
    issueNumber: number | null,
    now = new Date(),
  ): Promise<{ taskUsd: number; dayUsd: number }> {
    const total = async (where: string, params: Record<string, unknown>) => {
      const row = await this.jobs
        .createQueryBuilder('job')
        .select("COALESCE(SUM((job.usage->>'costUsd')::numeric), 0)", 'sum')
        .where('job.userId = :userId', { userId })
        .andWhere(where, params)
        .getRawOne<{ sum: string }>();

      return Number(row?.sum ?? 0);
    };

    const dayUsd = await total(
      "job.taskKey LIKE 'improve:%' AND job.createdAt >= :since",
      { since: new Date(now.getTime() - DAY_MS) },
    );
    const taskUsd =
      issueNumber === null
        ? 0
        : await total('(job.taskKey = :exact OR job.taskKey LIKE :prefix)', {
            exact: `improve:${issueNumber}`,
            prefix: `improve:${issueNumber}:%`,
          });

    return { taskUsd, dayUsd };
  }

  private async decide(
    run: Pick<ImproveRun, 'userId' | 'issueNumber' | 'model'>,
    alreadyEscalated: boolean,
  ): Promise<{ decision: EscalationDecision; settings: EscalationSettings }> {
    const settings = await this.settingsFor(run.userId);

    if (!settings.enabled) {
      return {
        settings,
        decision: { action: 'skip', reason: 'off' },
      };
    }

    const { taskUsd, dayUsd } = await this.spend(run.userId, run.issueNumber);

    return {
      settings,
      decision: decideEscalation({
        settings,
        model: run.model,
        alreadyEscalated,
        taskSpentUsd: taskUsd,
        daySpentUsd: dayUsd,
      }),
    };
  }

  // ------------------------------------------------------- a failed run

  @Interval(SWEEP_EVERY_MS)
  async sweep(now = new Date()): Promise<void> {
    if (this.sweeping) return;

    this.sweeping = true;

    try {
      // Paused: nothing starts on its own.
      if (await this.control?.isPaused()) return;

      const failed = await this.runs.find({
        where: {
          kind: 'issue',
          status: ImproveRunStatus.Failed,
          failureCause: 'task',
          finishedAt: MoreThan(new Date(now.getTime() - MAX_FAILURE_AGE_MS)),
        },
        order: { id: 'ASC' },
        take: MAX_PER_SWEEP,
      });

      for (const run of failed) {
        await this.escalateFailed(run).catch((error) =>
          this.logger.warn(
            `Escalation of run ${run.id} failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    } finally {
      this.sweeping = false;
    }
  }

  // Decides once per failed run: the same issue again one step up, or the reason it was not. Returns what happened (for the tests and the log).
  async escalateFailed(run: ImproveRun): Promise<string> {
    if (run.issueNumber === null) return 'no-issue';

    const claimed = await this.runs.update(
      { id: run.id, failureCause: 'task' },
      { failureCause: 'task-handled' },
    );

    // Another tick got it first.
    if (claimed.affected !== 1) return 'claimed-elsewhere';

    const { decision, settings } = await this.decide(run, isStepUp(run));

    if (decision.action === 'skip') {
      return this.skipped(run, decision.reason, settings);
    }

    try {
      const next = await this.improve.startRun(
        run.userId,
        run.issueNumber,
        decision.to,
        'escalation',
        run.scheduleId,
        run.contextId,
        undefined,
        run.id,
      );

      await this.runs.update(next.id, {
        note: escalationNote(run.model, decision.to, 'failed'),
      });
      await this.notifier.send(
        `⬆️ Задача #${run.issueNumber}: запуск на ${run.model} не удался — повторяю один раз на ${decision.to} (запуск #${next.id})`,
      );
      this.logger.log(
        `Run ${run.id} (issue #${run.issueNumber}): failed on ${run.model} → run ${next.id} on ${decision.to}`,
      );

      return 'escalated';
    } catch (error) {
      // The issue is busy (somebody started it by hand meanwhile): try again at the next sweep. Anything else was a try that cannot work (the issue was
      // closed, no model for it) and is not repeated.
      if (error instanceof ConflictException) {
        await this.runs.update(run.id, { failureCause: 'task' });

        return 'busy';
      }

      if (!(error instanceof BadRequestException)) {
        await this.runs.update(run.id, { failureCause: 'task' });

        throw error;
      }

      return 'not-startable';
    }
  }

  private async skipped(
    run: ImproveRun,
    reason: Parameters<typeof describeSkip>[0],
    settings: EscalationSettings,
  ): Promise<string> {
    // Silent when it is just switched off or there is nowhere higher to go; a refusal over money is something the owner should hear about.
    if (reason === 'task-cap' || reason === 'day-cap') {
      await this.notifier.send(
        `⏸ Задача #${run.issueNumber}: запуск на ${run.model} не удался, а на ступень выше не поднимаюсь — ${describeSkip(reason, settings)}`,
      );
    }

    return `skipped:${reason}`;
  }

  // ------------------------------------------------- a pull request, CI red

  // The decision for the one more CI repair, on a stronger model, after the automatic ones: `repairs` are the pull request's CI repair runs so far.
  async forRepair(
    parent: ImproveRun,
    repairs: ImproveRun[],
  ): Promise<{
    decision: EscalationDecision;
    settings: EscalationSettings;
    from: string;
    lastRepairId: number;
  }> {
    const last = repairs.reduce((a, b) => (b.id > a.id ? b : a), repairs[0]);
    const from = last?.model ?? parent.model;
    const { decision, settings } = await this.decide(
      { userId: parent.userId, issueNumber: parent.issueNumber, model: from },
      repairs.some(isStepUp),
    );

    return { decision, settings, from, lastRepairId: last?.id ?? parent.id };
  }

  describeRefusal(
    decision: EscalationDecision,
    settings: EscalationSettings,
  ): string | null {
    return decision.action === 'skip' &&
      (decision.reason === 'task-cap' || decision.reason === 'day-cap')
      ? `на ступень выше не поднимаюсь — ${describeSkip(decision.reason, settings)}`
      : null;
  }
}
