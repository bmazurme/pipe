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
import { GithubApiService } from '../loop/github-api.service';
import { isValidTimeZone } from '../telegram/notification-settings.service';
import { NotifyService } from '../telegram/notify.service';
import { AnalysisCategory, DEFAULT_CATEGORIES, isCategory } from './analysis';
import { ImproveSchedule } from './entities/improve-schedule.entity';
import { isDue, localDate, onAllowedWeekday, PR_LABEL } from './improve-shared';
import { ImproveService } from './improve.service';

const SCHEDULE_TICK_MS = 60_000;

@Injectable()
export class ImproveScheduleService implements OnModuleInit {
  private readonly logger = new Logger(ImproveScheduleService.name);
  private ticking = false;

  constructor(
    @InjectRepository(ImproveSchedule)
    private readonly schedules: Repository<ImproveSchedule>,
    private readonly improve: ImproveService,
    private readonly github: GithubApiService,
    private readonly notifier: NotifyService,
    private readonly contexts: ContextService,
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
      kind: 'improve',
    }));
  }

  listSchedules(): Promise<ImproveSchedule[]> {
    return this.schedules.find({ order: { id: 'ASC' } });
  }

  async saveSchedule(
    userId: number,
    input: Pick<
      ImproveSchedule,
      'name' | 'hour' | 'minute' | 'timezone' | 'count' | 'model' | 'enabled'
    > & {
      label?: string;
      kind?: 'issues' | 'analysis';
      categories?: string[];
      autoCreateIssues?: boolean;
      autoStartIssues?: boolean;
      contextId?: number | null;
      weekdays?: number[] | null;
    },
    id?: number,
  ): Promise<ImproveSchedule> {
    this.improve.requireModel(input.model);

    if (!isValidTimeZone(input.timezone)) {
      throw new BadRequestException(
        `Неизвестный часовой пояс: ${input.timezone}`,
      );
    }

    // Only one of the owner's own contexts can be attached (404 otherwise).
    if (input.contextId !== undefined && input.contextId !== null) {
      await this.contexts.findOwned(input.contextId, userId);
    }

    const schedule = id
      ? await this.schedules.findOne({ where: { id } })
      : this.schedules.create({ userId });

    if (!schedule) throw new NotFoundException('Schedule not found');

    const categories = input.categories ?? [];

    if (!categories.every(isCategory)) {
      throw new BadRequestException('Неизвестное направление анализа');
    }

    Object.assign(schedule, {
      ...input,
      kind: input.kind ?? 'issues',
      label: input.label || PR_LABEL,
      categories: categories.length ? categories.join(',') : null,
      autoCreateIssues: input.autoCreateIssues ?? true,
      autoStartIssues: input.autoStartIssues ?? false,
      contextId: input.contextId ?? null,
      weekdays: input.weekdays?.length
        ? [...new Set(input.weekdays)].sort((a, b) => a - b)
        : null,
    });

    return this.schedules.save(schedule);
  }

  async deleteSchedule(id: number): Promise<void> {
    await this.schedules.delete(id);
  }

  async runScheduleNow(
    id: number,
  ): Promise<{ started: number[]; skipped: string[] }> {
    const schedule = await this.schedules.findOne({ where: { id } });

    if (!schedule) throw new NotFoundException('Schedule not found');

    return this.fire(schedule);
  }

  @Interval(SCHEDULE_TICK_MS)
  async tickSchedules(now = new Date()): Promise<void> {
    if (this.ticking || !this.github.isReady()) return;

    this.ticking = true;

    try {
      for (const schedule of await this.schedules.find({
        where: { enabled: true },
      })) {
        if (!isDue(schedule, now) || !onAllowedWeekday(schedule, now)) continue;

        // Claim today's slot first (compare-and-set), so two ticks — or two
        // bridge instances — never fire the same schedule twice.
        const claim = await this.schedules
          .createQueryBuilder()
          .update()
          .set({ lastRunOn: localDate(now, schedule.timezone), lastRunAt: now })
          .where(
            'id = :id AND ("lastRunOn" IS NULL OR "lastRunOn" <> :today)',
            {
              id: schedule.id,
              today: localDate(now, schedule.timezone),
            },
          )
          .execute();

        if (claim.affected !== 1) continue;

        await this.fire(schedule).catch((error) =>
          this.logger.warn(`Schedule ${schedule.id} failed: ${message(error)}`),
        );
      }
    } finally {
      this.ticking = false;
    }
  }

  // Starts up to `count` of the oldest eligible issues. An issue already being worked
  // on or with an open PR is skipped (startRun refuses it), as is one that fails to
  // start — the rest still run.
  async fire(
    schedule: ImproveSchedule,
  ): Promise<{ started: number[]; skipped: string[] }> {
    const started: number[] = [];
    const skipped: string[] = [];

    this.improve.requireConfigured();

    if (schedule.kind === 'analysis') {
      const categories = schedule.categories
        ? (schedule.categories
            .split(',')
            .filter(isCategory) as AnalysisCategory[])
        : DEFAULT_CATEGORIES;
      let summary: string;

      try {
        const run = await this.improve.startAnalysis(
          schedule.userId,
          schedule.model,
          categories,
          schedule.autoCreateIssues || schedule.autoStartIssues,
          'schedule',
          schedule.id,
          schedule.autoStartIssues,
          schedule.contextId ?? null,
        );

        started.push(run.id);
        summary = 'анализ запущен';
      } catch (error) {
        skipped.push(message(error));
        summary = `анализ не запущен: ${message(error)}`;
      }

      void this.report(schedule, summary, '');

      return { started, skipped };
    }

    for (const issue of await this.github.listOpenIssues(schedule.label, 100)) {
      if (started.length >= schedule.count) break;

      try {
        await this.improve.startRun(
          schedule.userId,
          issue.number,
          schedule.model,
          'schedule',
          schedule.id,
          schedule.contextId ?? null,
        );
        started.push(issue.number);
      } catch (error) {
        skipped.push(`#${issue.number}: ${message(error)}`);
      }
    }

    const summary = `${started.length} запущено${skipped.length ? `, ${skipped.length} пропущено` : ''}`;

    void this.report(
      schedule,
      summary,
      started.length ? ` (${started.map((n) => `#${n}`).join(', ')})` : '',
    );

    return { started, skipped };
  }

  // Runs in the background: the caller never waits on the database write or Telegram.
  private async report(
    schedule: ImproveSchedule,
    summary: string,
    suffix: string,
  ): Promise<void> {
    try {
      await this.schedules.update(schedule.id, {
        lastRunAt: new Date(),
        lastResult: summary,
      });
      await this.notifier.send(
        `🌙 Расписание «${schedule.name}»: ${summary}${suffix}`,
      );
    } catch (error) {
      this.logger.warn(
        `Schedule ${schedule.id} result could not be reported: ${message(error)}`,
      );
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
