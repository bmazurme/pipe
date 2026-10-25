import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import {
  ContextScheduleUse,
  ContextUsageRegistry,
} from '../context/context-usage';
import { ContextService } from '../context/context.service';
import {
  isDue,
  localDate,
  message,
  onAllowedWeekday,
  requireImproveModel,
} from '../improve/improve-shared';
import { isValidTimeZone } from '../telegram/notification-settings.service';
import { NotifyService } from '../telegram/notify.service';
import { LabSchedule } from './entities/lab-schedule.entity';
import type { LabExecutor } from './lab-executor';
import { LabProjectsService } from './lab-projects.service';
import { LabRunsService } from './lab-runs.service';

const SCHEDULE_TICK_MS = 60_000;

type ScheduleInput = Pick<
  LabSchedule,
  | 'projectId'
  | 'name'
  | 'enabled'
  | 'hour'
  | 'minute'
  | 'timezone'
  | 'model'
  | 'task'
> & {
  contextId?: number | null;
  weekdays?: number[] | null;
  executor?: LabExecutor;
  onlyOnNewCommits?: boolean;
};

// Kept importable from here for existing callers; the helper itself is shared with Improve's schedules.
export { onAllowedWeekday };

@Injectable()
export class LabSchedulesService implements OnModuleInit {
  private readonly logger = new Logger(LabSchedulesService.name);
  private ticking = false;

  constructor(
    @InjectRepository(LabSchedule)
    private readonly schedules: Repository<LabSchedule>,
    private readonly projects: LabProjectsService,
    private readonly runs: LabRunsService,
    private readonly contexts: ContextService,
    private readonly notifier: NotifyService,
    private readonly contextUsage: ContextUsageRegistry,
  ) {}

  onModuleInit(): void {
    this.contextUsage.register({
      schedulesFor: (userId, contextIds) =>
        this.schedulesUsingContexts(userId, contextIds),
    });
  }

  // For the Context page: which of the user's schedules hand one of these contexts to their runs.
  async schedulesUsingContexts(
    userId: number,
    contextIds: number[],
  ): Promise<ContextScheduleUse[]> {
    const rows = await this.schedules.find({
      select: ['id', 'name', 'contextId'],
      where: { userId, contextId: In(contextIds) },
      order: { name: 'ASC' },
    });

    return rows.map((row) => ({
      contextId: row.contextId as number,
      id: row.id,
      name: row.name,
      kind: 'lab',
    }));
  }

  list(userId: number): Promise<LabSchedule[]> {
    return this.schedules.find({ where: { userId }, order: { id: 'ASC' } });
  }

  async save(
    userId: number,
    input: ScheduleInput,
    id?: number,
  ): Promise<LabSchedule> {
    requireImproveModel(input.model);

    if (!isValidTimeZone(input.timezone))
      throw new BadRequestException(
        `Неизвестный часовой пояс: ${input.timezone}`,
      );

    await this.projects.findOwned(input.projectId, userId);

    if (input.contextId) await this.contexts.findOwned(input.contextId, userId);

    const schedule = id
      ? await this.schedules.findOne({ where: { id, userId } })
      : this.schedules.create({ userId });

    if (!schedule) throw new NotFoundException('Schedule not found');

    Object.assign(schedule, {
      ...input,
      contextId: input.contextId ?? null,
      executor: input.executor ?? 'any',
      onlyOnNewCommits: input.onlyOnNewCommits ?? false,
      weekdays: input.weekdays?.length
        ? [...input.weekdays].sort((a, b) => a - b)
        : null,
    });

    return this.schedules.save(schedule);
  }

  async remove(id: number, userId: number): Promise<void> {
    await this.schedules.delete({ id, userId });
  }

  async runNow(
    id: number,
    userId: number,
  ): Promise<{ runId: number | null; error: string | null }> {
    const schedule = await this.schedules.findOne({ where: { id, userId } });

    if (!schedule) throw new NotFoundException('Schedule not found');

    return this.fire(schedule);
  }

  @Interval(SCHEDULE_TICK_MS)
  async tick(now = new Date()): Promise<void> {
    if (this.ticking) return;

    this.ticking = true;

    try {
      for (const schedule of await this.schedules.find({
        where: { enabled: true },
      })) {
        if (!isDue(schedule, now) || !onAllowedWeekday(schedule, now)) continue;

        // Claim today's slot first (compare-and-set), so two ticks — or two bridge instances — never fire one schedule twice.
        const claim = await this.schedules
          .createQueryBuilder()
          .update()
          .set({ lastRunOn: localDate(now, schedule.timezone), lastRunAt: now })
          .where(
            'id = :id AND ("lastRunOn" IS NULL OR "lastRunOn" <> :today)',
            { id: schedule.id, today: localDate(now, schedule.timezone) },
          )
          .execute();

        if (claim.affected !== 1) continue;

        if (schedule.onlyOnNewCommits) {
          const unchanged = await this.runs.unchangedSinceLastRun(
            schedule.userId,
            schedule.projectId,
            schedule.id,
          );

          if (unchanged) {
            await this.schedules
              .update(schedule.id, {
                lastResult: `пропущено: в ${unchanged.branch} нет новых коммитов (${unchanged.sha.slice(0, 7)})`,
              })
              .catch((error) =>
                this.logger.warn(
                  `Lab schedule ${schedule.id} skip could not be recorded: ${message(error)}`,
                ),
              );

            continue;
          }
        }

        await this.fire(schedule).catch((error) =>
          this.logger.warn(
            `Lab schedule ${schedule.id} failed: ${message(error)}`,
          ),
        );
      }
    } finally {
      this.ticking = false;
    }
  }

  async fire(
    schedule: LabSchedule,
  ): Promise<{ runId: number | null; error: string | null }> {
    let launched: Awaited<ReturnType<LabRunsService['launch']>>;

    try {
      launched = await this.runs.launch(
        schedule.userId,
        {
          projectId: schedule.projectId,
          task: schedule.task,
          model: schedule.model,
          contextId: schedule.contextId,
          executor: schedule.executor,
        },
        'schedule',
        schedule.id,
      );
    } catch (cause) {
      const error = message(cause);

      void this.report(schedule, `не запущено: ${error}`);

      return { runId: null, error };
    }

    // The caller gets the run as soon as it is recorded; the result and the Telegram summary wait for the preparation.
    const runId = launched.run.id;

    void launched.prepared.then(
      () => this.report(schedule, `запуск #${runId}`),
      (cause) =>
        this.report(
          schedule,
          `запуск #${runId} не подготовлен: ${message(cause)}`,
        ),
    );

    return { runId, error: null };
  }

  private async report(schedule: LabSchedule, summary: string): Promise<void> {
    try {
      await this.schedules.update(schedule.id, {
        lastRunAt: new Date(),
        lastResult: summary,
      });
      await this.notifier.send(
        `🧪 Lab, расписание «${schedule.name}»: ${summary}`,
      );
    } catch (error) {
      this.logger.warn(
        `Lab schedule ${schedule.id} result could not be reported: ${message(error)}`,
      );
    }
  }
}
