import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { strToU8 } from 'fflate';
import { In, Repository } from 'typeorm';

import {
  ImproveRun,
  ImproveRunKind,
  ImproveRunStatus,
} from '../improve/entities/improve-run.entity';
import { message, requireImproveModel } from '../improve/improve-shared';
import { launchIssueJob } from '../improve/issue-job';
import { readResultParcel } from '../improve/parcel';
import { GithubApiService } from '../loop/github-api.service';
import { StorageService } from '../storage/storage.service';
import { Job, JobStatus } from '../worker/entities/job.entity';
import { logExcerpt, LOG_TAIL_CHARS } from '../worker/run-history';
import { WorkerService } from '../worker/worker.service';
import type {
  SaveLabDigestSettingsDto,
  StartLabDigestDto,
  UpdateLabDigestDto,
} from './dto/lab-digest.dto';
import { LabDigest, LabDigestStatus } from './entities/lab-digest.entity';
import { LabDigestSettings } from './entities/lab-digest-settings.entity';
import { LabRun, LabRunStatus } from './entities/lab-run.entity';
import {
  autoDigestDue,
  buildDigestInput,
  cleanTags,
  DIGEST_INPUT_FILE,
  DIGEST_MAX_ITEMS,
  DIGEST_NOTE_TYPE,
  DIGEST_RESULT_FILE,
  digestPrompt,
  type DigestItem,
  isWeekStart,
  lastFinishedWeek,
  parseDigestResult,
  splitByVisibility,
  weekRange,
  weekStartOf,
} from './lab-digest';

const ADVANCE_EVERY_MS = 15_000;
const AUTO_EVERY_MS = 10 * 60_000;
// A digest with no job and untouched this long was lost to a restart between its row and its job.
const GENERATING_STALE_MS = 10 * 60_000;
// More than DIGEST_MAX_ITEMS, so what is left after the public filter still fills the digest.
const COLLECT_LIMIT = 200;
const LIST_LIMIT = 60;

export const DIGEST_DEFAULTS = {
  autoWeekly: false,
  includePrivate: false,
  model: 'haiku',
} as const;

export type DigestSettingsView = {
  autoWeekly: boolean;
  includePrivate: boolean;
  model: string;
};

export type DigestPreview = {
  weekStart: string;
  // What would go into the digest (newest first, at most DIGEST_MAX_ITEMS) and how much more there is.
  items: DigestItem[];
  omitted: number;
  excludedPrivate: number;
};

@Injectable()
export class LabDigestService {
  private readonly logger = new Logger(LabDigestService.name);
  private advancing = false;
  private autoRunning = false;
  // userId:week the automatic digest already looked at and found nothing for — not asked again until a restart.
  private readonly autoSkipped = new Set<string>();

  constructor(
    @InjectRepository(LabDigest)
    private readonly digests: Repository<LabDigest>,
    @InjectRepository(LabDigestSettings)
    private readonly settings: Repository<LabDigestSettings>,
    @InjectRepository(LabRun)
    private readonly labRuns: Repository<LabRun>,
    @InjectRepository(ImproveRun)
    private readonly improveRuns: Repository<ImproveRun>,
    @InjectRepository(Job)
    private readonly jobs: Repository<Job>,
    private readonly storage: StorageService,
    private readonly workers: WorkerService,
    private readonly github: GithubApiService,
  ) {}

  // — settings —

  async getSettings(userId: number): Promise<DigestSettingsView> {
    const row = await this.settings.findOne({ where: { userId } });

    return row
      ? {
          autoWeekly: row.autoWeekly,
          includePrivate: row.includePrivate,
          model: row.model,
        }
      : { ...DIGEST_DEFAULTS };
  }

  async saveSettings(
    userId: number,
    dto: SaveLabDigestSettingsDto,
  ): Promise<DigestSettingsView> {
    if (dto.model !== undefined) requireImproveModel(dto.model);

    const row =
      (await this.settings.findOne({ where: { userId } })) ??
      this.settings.create({ userId, ...DIGEST_DEFAULTS });

    if (dto.autoWeekly !== undefined) row.autoWeekly = dto.autoWeekly;
    if (dto.includePrivate !== undefined) {
      row.includePrivate = dto.includePrivate;
    }
    if (dto.model !== undefined) row.model = dto.model;

    await this.settings.save(row);

    return this.getSettings(userId);
  }

  // — what a week holds —

  private requireWeek(weekStart: string, now = new Date()): void {
    if (!isWeekStart(weekStart)) {
      throw new BadRequestException(
        'weekStart: нужен понедельник в формате YYYY-MM-DD',
      );
    }

    if (weekStart > weekStartOf(now)) {
      throw new BadRequestException('Эта неделя ещё не началась');
    }
  }

  // Everything the account finished in the week that is worth a line in a diary, newest first. No visibility filter yet.
  async collect(userId: number, weekStart: string): Promise<DigestItem[]> {
    const { from, to } = weekRange(weekStart);
    const items: DigestItem[] = [];

    const lab = await this.labRuns
      .createQueryBuilder('run')
      .where('run."userId" = :userId', { userId })
      .andWhere('run.status IN (:...statuses)', {
        statuses: [
          LabRunStatus.PrOpen,
          LabRunStatus.PrMerged,
          LabRunStatus.IssueOpen,
        ],
      })
      .andWhere('run."finishedAt" >= :from AND run."finishedAt" < :to', {
        from,
        to,
      })
      .orderBy('run."finishedAt"', 'DESC')
      .limit(COLLECT_LIMIT)
      .getMany();

    for (const run of lab) {
      items.push({
        source: 'lab',
        id: run.id,
        title: run.title,
        repo: run.repo,
        status: run.status,
        url: run.prUrl ?? run.issueUrl,
        finishedAt: (run.finishedAt as Date).toISOString(),
        jobId: run.jobId,
        model: null,
        costUsd: null,
      });
    }

    const improve = await this.improveRuns
      .createQueryBuilder('run')
      .where('run."userId" = :userId', { userId })
      .andWhere('run.status IN (:...statuses)', {
        statuses: [
          ImproveRunStatus.PrOpen,
          ImproveRunStatus.PrUpdated,
          ImproveRunStatus.Analyzed,
        ],
      })
      .andWhere('run."finishedAt" >= :from AND run."finishedAt" < :to', {
        from,
        to,
      })
      .orderBy('run."finishedAt"', 'DESC')
      .limit(COLLECT_LIMIT)
      .getMany();

    const improveRepo = this.github.repoName() ?? null;

    for (const run of improve) {
      items.push({
        source: 'improve',
        id: run.id,
        title: improveTitle(run),
        repo: improveRepo,
        status: run.status,
        url: run.prUrl,
        finishedAt: (run.finishedAt as Date).toISOString(),
        jobId: run.jobId,
        model: run.model === 'auto' ? null : run.model,
        costUsd: null,
      });
    }

    const known = new Set(
      [...lab, ...improve]
        .map((run) => run.jobId)
        .filter((id): id is number => id !== null),
    );
    const parcels = await this.jobs
      .createQueryBuilder('job')
      .select(['job.id', 'job.taskKey', 'job.model', 'job.finishedAt'])
      .where('job."userId" = :userId', { userId })
      .andWhere('job.status = :status', { status: JobStatus.Succeeded })
      .andWhere('job."taskKey" IS NOT NULL AND job."taskKey" NOT LIKE :file', {
        file: 'file:%',
      })
      .andWhere('job."finishedAt" >= :from AND job."finishedAt" < :to', {
        from,
        to,
      })
      .orderBy('job."finishedAt"', 'DESC')
      .limit(COLLECT_LIMIT)
      .getMany();

    // A run of Lab/Improve has its own job (and its own line above, when it produced something); a job that belongs to a run
    // that produced nothing is not a parcel either.
    const owned = await this.runJobIds(
      userId,
      parcels.map((job) => job.id).filter((id) => !known.has(id)),
    );

    for (const job of parcels) {
      if (known.has(job.id) || owned.has(job.id)) continue;

      items.push({
        source: 'parcel',
        id: job.id,
        title: `Задача ${job.taskKey}`,
        repo: null,
        status: 'succeeded',
        url: null,
        finishedAt: (job.finishedAt as Date).toISOString(),
        jobId: job.id,
        model: job.model,
        costUsd: null,
      });
    }

    items.sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));

    return items;
  }

  private async runJobIds(
    userId: number,
    jobIds: number[],
  ): Promise<Set<number>> {
    if (jobIds.length === 0) return new Set();

    const [lab, improve] = await Promise.all([
      this.labRuns.find({
        where: { userId, jobId: In(jobIds) },
        select: ['id', 'jobId'],
      }),
      this.improveRuns.find({
        where: { userId, jobId: In(jobIds) },
        select: ['id', 'jobId'],
      }),
    ]);

    return new Set(
      [...lab, ...improve]
        .map((run) => run.jobId)
        .filter((id): id is number => id !== null),
    );
  }

  async preview(
    userId: number,
    weekStart: string,
    includePrivate?: boolean,
  ): Promise<DigestPreview> {
    this.requireWeek(weekStart);

    const allow =
      includePrivate ?? (await this.getSettings(userId)).includePrivate;
    const { included, excludedPrivate } = await splitByVisibility(
      await this.collect(userId, weekStart),
      allow,
    );

    return {
      weekStart,
      items: included.slice(0, DIGEST_MAX_ITEMS),
      omitted: Math.max(0, included.length - DIGEST_MAX_ITEMS),
      excludedPrivate,
    };
  }

  // The model, the cost and the end of the output of each job, for the lines of the digest.
  private async jobFacts(
    userId: number,
    jobIds: number[],
  ): Promise<{
    excerpts: Map<number, string>;
    facts: Map<number, { model: string; costUsd: number | null }>;
  }> {
    const excerpts = new Map<number, string>();
    const facts = new Map<number, { model: string; costUsd: number | null }>();

    if (jobIds.length === 0) return { excerpts, facts };

    // RIGHT of the log: a finished run's log can be megabytes. CAST: an untyped parameter would make RIGHT ambiguous.
    const { entities, raw } = await this.jobs
      .createQueryBuilder('job')
      .select(['job.id', 'job.model', 'job.usage'])
      .addSelect(
        `RIGHT(COALESCE("job"."logs", ''), CAST(:logTail AS integer))`,
        'logsTail',
      )
      .where('job."userId" = :userId AND job.id IN (:...ids)', {
        userId,
        ids: jobIds,
      })
      .setParameter('logTail', LOG_TAIL_CHARS)
      .getRawAndEntities<{ logsTail: string | null }>();

    entities.forEach((job, index) => {
      facts.set(job.id, {
        model: job.model,
        costUsd: job.usage?.costUsd ?? null,
      });
      excerpts.set(job.id, logExcerpt(raw[index]?.logsTail ?? ''));
    });

    return { excerpts, facts };
  }

  // — digests —

  list(userId: number): Promise<LabDigest[]> {
    return this.digests.find({
      where: { userId },
      order: { weekStart: 'DESC' },
      take: LIST_LIMIT,
    });
  }

  async findOwned(id: number, userId: number): Promise<LabDigest> {
    const row = await this.digests.findOne({ where: { id, userId } });

    if (!row) throw new NotFoundException('Дайджест не найден');

    return row;
  }

  // Collects the week and hands a worker the job of writing the note. One digest per week: a finished one is made again
  // (its text replaced), one still being written is refused.
  async start(userId: number, dto: StartLabDigestDto): Promise<LabDigest> {
    this.requireWeek(dto.weekStart);

    const defaults = await this.getSettings(userId);
    const model = dto.model ?? defaults.model;
    const includePrivate = dto.includePrivate ?? defaults.includePrivate;

    requireImproveModel(model);

    const existing = await this.digests.findOne({
      where: { userId, weekStart: dto.weekStart },
    });

    if (existing?.status === LabDigestStatus.Generating) {
      throw new ConflictException('Дайджест этой недели уже собирается');
    }

    const { included, excludedPrivate } = await splitByVisibility(
      await this.collect(userId, dto.weekStart),
      includePrivate,
    );

    if (included.length === 0) {
      throw new BadRequestException(
        excludedPrivate > 0
          ? `За неделю нет работ в публичных репозиториях (скрыто приватных: ${excludedPrivate}) — включите приватные в настройках`
          : 'За неделю нет завершённых работ',
      );
    }

    const used = included.slice(0, DIGEST_MAX_ITEMS);
    const { excerpts, facts } = await this.jobFacts(
      userId,
      used.map((item) => item.jobId).filter((id): id is number => id !== null),
    );
    const items = used.map((item) => {
      const fact = item.jobId ? facts.get(item.jobId) : undefined;

      return fact
        ? { ...item, model: item.model ?? fact.model, costUsd: fact.costUsd }
        : item;
    });

    const row =
      existing ?? this.digests.create({ userId, weekStart: dto.weekStart });

    Object.assign(row, {
      status: LabDigestStatus.Generating,
      includePrivate,
      model,
      jobId: null,
      items,
      excludedPrivate,
      title: null,
      preview: null,
      content: null,
      tags: [],
      noteType: DIGEST_NOTE_TYPE,
      error: null,
      exportedAt: null,
      finishedAt: null,
    });

    const saved = await this.digests.save(row);

    try {
      const input = buildDigestInput(
        { weekStart: dto.weekStart },
        items,
        excerpts,
        included.length - used.length,
      );
      const { job } = await launchIssueJob(
        { storage: this.storage, workers: this.workers },
        {
          userId,
          files: [{ path: DIGEST_INPUT_FILE, bytes: strToU8(input) }],
          task: {
            number: saved.id,
            title: `Дайджест недели ${dto.weekStart}`,
            body: digestPrompt({ weekStart: dto.weekStart }),
            repo: 'digest',
            baseBranch: 'main',
          },
          baseline: {},
          fileName: `lab-digest-${dto.weekStart}.zip`,
          taskKey: `lab-digest:${saved.id}`,
          model,
        },
      );

      saved.jobId = job.id;
      await this.digests.save(saved);
    } catch (error) {
      saved.status = LabDigestStatus.Failed;
      saved.error = message(error);
      saved.finishedAt = new Date();
      await this.digests.save(saved);
    }

    return saved;
  }

  async update(
    id: number,
    userId: number,
    dto: UpdateLabDigestDto,
  ): Promise<LabDigest> {
    const row = await this.findOwned(id, userId);

    if (
      row.status !== LabDigestStatus.Draft &&
      row.status !== LabDigestStatus.Exported
    ) {
      throw new ConflictException('Править можно только готовый черновик');
    }

    if (dto.title !== undefined) row.title = dto.title;
    if (dto.preview !== undefined) row.preview = dto.preview;
    if (dto.content !== undefined) row.content = dto.content;
    if (dto.tags !== undefined) row.tags = cleanTags(dto.tags);

    return this.digests.save(row);
  }

  // The owner carried the note to notes.ntlstl.dev by hand (P0 has no automatic delivery).
  async markExported(id: number, userId: number): Promise<LabDigest> {
    const row = await this.findOwned(id, userId);

    if (!row.content) {
      throw new ConflictException('В дайджесте ещё нет текста');
    }

    row.status = LabDigestStatus.Exported;
    row.exportedAt = new Date();

    return this.digests.save(row);
  }

  async remove(id: number, userId: number): Promise<void> {
    const row = await this.findOwned(id, userId);

    await this.digests.delete(row.id);
  }

  // — progress —

  @Interval(ADVANCE_EVERY_MS)
  async advance(): Promise<void> {
    if (this.advancing) return;

    this.advancing = true;

    try {
      const rows = await this.digests.find({
        where: { status: LabDigestStatus.Generating },
      });

      if (rows.length === 0) return;

      const statuses = new Map(
        (
          await this.workers.findStatuses(
            rows
              .map((row) => row.jobId)
              .filter((id): id is number => id !== null),
          )
        ).map((job) => [job.id, job]),
      );

      for (const row of rows) {
        await this.advanceOne(
          row,
          row.jobId ? statuses.get(row.jobId) : undefined,
        ).catch((error) =>
          this.logger.warn(
            `Digest ${row.id} could not be advanced: ${message(error)}`,
          ),
        );
      }
    } finally {
      this.advancing = false;
    }
  }

  async advanceOne(
    row: LabDigest,
    job: Awaited<ReturnType<WorkerService['findStatuses']>>[number] | undefined,
    now = Date.now(),
  ): Promise<void> {
    if (row.jobId === null) {
      if (now - row.updatedAt.getTime() > GENERATING_STALE_MS) {
        await this.fail(row, 'Сборка прервана перезапуском — соберите заново');
      }

      return;
    }

    if (!job || job.userId !== row.userId) {
      await this.fail(row, 'Задача worker не найдена');

      return;
    }

    if (job.status === JobStatus.Failed || job.status === JobStatus.Cancelled) {
      await this.fail(
        row,
        job.status === JobStatus.Cancelled
          ? 'Задача остановлена'
          : (job.errorMessage ?? 'Задача worker завершилась ошибкой'),
      );

      return;
    }

    if (job.status !== JobStatus.Succeeded) return;

    try {
      if (job.resultFileId === null) throw new Error('У задачи нет результата');

      const file = await this.storage.findOwned(job.resultFileId, row.userId);
      const result = await readResultParcel(await this.storage.readBytes(file));
      const raw = result.get(DIGEST_RESULT_FILE);

      if (!raw) throw new Error(`Worker не создал ${DIGEST_RESULT_FILE}`);

      const note = parseDigestResult(raw);

      row.title = note.title;
      row.preview = note.preview;
      row.content = note.content;
      row.tags = note.tags;
      row.status = LabDigestStatus.Draft;
      row.error = null;
      row.finishedAt = new Date();
      await this.digests.save(row);
    } catch (error) {
      await this.fail(row, message(error));
    }
  }

  private async fail(row: LabDigest, error: string): Promise<void> {
    row.status = LabDigestStatus.Failed;
    row.error = error.slice(0, 2000);
    row.finishedAt = new Date();
    await this.digests.save(row);
  }

  // Monday morning: the week that just ended, for every account that asked for it. Once per week and account — a digest that
  // failed or was deleted is not made again by itself (the owner can press the button).
  @Interval(AUTO_EVERY_MS)
  async autoWeekly(now = new Date()): Promise<void> {
    if (this.autoRunning || !autoDigestDue(now)) return;

    this.autoRunning = true;

    try {
      const week = lastFinishedWeek(now);
      const accounts = await this.settings.find({
        where: { autoWeekly: true },
      });

      for (const account of accounts) {
        const key = `${account.userId}:${week}`;

        if (this.autoSkipped.has(key)) continue;

        this.autoSkipped.add(key);

        const exists = await this.digests.exist({
          where: { userId: account.userId, weekStart: week },
        });

        if (exists) continue;

        await this.start(account.userId, { weekStart: week }).catch((error) =>
          this.logger.log(
            `Automatic digest for ${key} not made: ${message(error)}`,
          ),
        );
      }
    } finally {
      this.autoRunning = false;
    }
  }
}

function improveTitle(run: ImproveRun): string {
  if (run.kind === ('analysis' satisfies ImproveRunKind)) {
    return `Анализ репозитория${proposalCount(run.result)}`;
  }

  const prefix = run.kind === 'repair' ? 'Починка CI: ' : '';

  return `${prefix}${run.issueNumber ? `#${run.issueNumber} ` : ''}${run.issueTitle}`;
}

function proposalCount(result: string | null): string {
  if (!result) return '';

  try {
    const parsed = JSON.parse(result) as { items?: unknown };

    return Array.isArray(parsed.items)
      ? ` — предложений: ${parsed.items.length}`
      : '';
  } catch {
    return '';
  }
}
