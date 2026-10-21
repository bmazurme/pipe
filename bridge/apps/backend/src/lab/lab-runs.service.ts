import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { message, requireImproveModel } from '../improve/improve-shared';
import { buildIssueParcel, readZipball } from '../improve/parcel';
import { SharedAsyncCache } from '../common/shared-async-cache';
import { ContextService } from '../context/context.service';
import { StoredFileDirection } from '../storage/entities/stored-file.entity';
import { StorageService } from '../storage/storage.service';
import { WORKER_CAPABILITY_LABEL } from '../worker/capabilities';
import { JobModel, JobStatus } from '../worker/entities/job.entity';
import { JobStatusRow, WorkerService } from '../worker/worker.service';
import {
  ACTIVE_LAB_RUN_STATUSES,
  LabRun,
  LabRunStatus,
  LabTrigger,
} from './entities/lab-run.entity';
import {
  downloadRepoZip,
  githubFor,
  readStep,
  ZIP_TOTAL_MS,
} from './lab-github';
import { LabProject } from './entities/lab-project.entity';
import { requiredCapabilityOf, type LabExecutor } from './lab-executor';
import { LabProjectsService } from './lab-projects.service';
import { LabPublishService } from './lab-publish.service';
import {
  labEnvironment,
  parcelEntries,
  LabSnapshot,
  selectLabSnapshot,
  taskWithSkipped,
} from './lab-result';

const ADVANCE_EVERY_MS = 15_000;
// A run claimed for publishing and untouched this long was lost to a restart.
const PUBLISHING_STALE_MS = 10 * 60_000;
// Same lifetime and bound as Improve's handoff cache.
const SNAPSHOT_CACHE_TTL_MS = 10 * 60 * 1000;
const SNAPSHOT_CACHE_SIZE = 2;
// A run still preparing after the longest possible download plus a margin was lost to a restart.
const PREPARING_STALE_MS = ZIP_TOTAL_MS + 5 * 60_000;

// Kept here so callers of the run service need not know where publishing lives.
export { isBlocked } from './lab-publish.service';

export type LabStartInput = {
  projectId: number;
  task: string;
  model: string;
  contextId?: number | null;
  // A branch other than the project's own, for this run only.
  baseBranch?: string;
  // Where to run: any worker (default) or one set up for Fusion 360.
  executor?: LabExecutor;
  // A run (of this project, with its pull request open) whose PR branch this one adds a commit to.
  followUpOf?: number;
};

export function titleOf(task: string): string {
  const line = task.trim().split('\n')[0].trim();

  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

@Injectable()
export class LabRunsService {
  private readonly logger = new Logger(LabRunsService.name);
  private advancing = false;
  // Recent repo snapshots and the ones being built right now, so consecutive or concurrent
  // starts on one project + base SHA download the repository once.
  private readonly snapshots = new SharedAsyncCache<LabSnapshot>({
    ttlMs: SNAPSHOT_CACHE_TTL_MS,
    maxEntries: SNAPSHOT_CACHE_SIZE,
  });

  constructor(
    @InjectRepository(LabRun)
    private readonly runs: Repository<LabRun>,
    private readonly projects: LabProjectsService,
    private readonly workers: WorkerService,
    private readonly storage: StorageService,
    private readonly contexts: ContextService,
    private readonly publisher: LabPublishService,
  ) {}

  list(userId: number, limit = 50): Promise<LabRun[]> {
    return this.runs.find({
      where: { userId },
      order: { id: 'DESC' },
      take: limit,
    });
  }

  // Answers as soon as the run is recorded: the slow part goes on in the background, and its
  // outcome lands on the run row itself (Queued, or Failed with the step message).
  async start(
    userId: number,
    input: LabStartInput,
    trigger: LabTrigger = 'manual',
    scheduleId: number | null = null,
  ): Promise<LabRun> {
    const { run, prepared } = await this.launch(
      userId,
      input,
      trigger,
      scheduleId,
    );

    prepared.catch((error) =>
      this.logger.warn(
        `Lab run ${run.id} could not be prepared: ${message(error)}`,
      ),
    );

    return run;
  }

  // Validation errors and the Preparing row come before this resolves; `prepared` settles once the
  // job is queued, or rejects after the run has been marked failed.
  async launch(
    userId: number,
    input: LabStartInput,
    trigger: LabTrigger = 'manual',
    scheduleId: number | null = null,
  ): Promise<{ run: LabRun; prepared: Promise<LabRun> }> {
    requireImproveModel(input.model);

    const project = await this.projects.findOwned(input.projectId, userId);

    if (!project.canWrite) {
      throw new BadRequestException(
        'Токен проекта не может писать в репозиторий — проверьте подключение',
      );
    }
    if (input.contextId) await this.contexts.findOwned(input.contextId, userId);

    const active = await this.runs.count({
      where: {
        projectId: project.id,
        task: input.task,
        status: In(ACTIVE_LAB_RUN_STATUSES),
      },
    });

    if (active > 0)
      throw new ConflictException('Эта задача в этом проекте уже выполняется');

    const executor = input.executor ?? 'any';
    const capability = requiredCapabilityOf(executor);

    // Better a clear answer now than a run that waits for ever for a worker that does not exist.
    if (
      capability &&
      !(await this.workers.hasEnabledWorkerWith(userId, capability))
    ) {
      throw new BadRequestException(
        `Нет включённого worker с ${WORKER_CAPABILITY_LABEL[capability]} — добавьте его на странице Worker`,
      );
    }

    const title = titleOf(input.task);
    let baseBranch = input.baseBranch || project.baseBranch;
    let pr: Pick<LabRun, 'branch' | 'prNumber' | 'prUrl'> = {
      branch: null,
      prNumber: null,
      prUrl: null,
    };

    if (input.followUpOf) {
      const parent = await this.runs.findOne({
        where: { id: input.followUpOf, userId },
      });

      if (!parent)
        throw new NotFoundException('Запуск для доработки не найден');
      if (
        parent.projectId !== project.id ||
        parent.status !== LabRunStatus.PrOpen ||
        !parent.branch ||
        !parent.prNumber
      )
        throw new BadRequestException(
          'Доработать можно только запуск этого проекта с открытым PR',
        );
      baseBranch = parent.branch;
      pr = {
        branch: parent.branch,
        prNumber: parent.prNumber,
        prUrl: parent.prUrl,
      };
    }
    // Recorded before the slow part so that a second start (or the nightly tick) of the same task sees it as active.
    const run = await this.runs.save(
      this.runs.create({
        userId,
        projectId: project.id,
        repo: project.repo,
        scheduleId,
        trigger,
        title,
        task: input.task,
        model: input.model,
        status: LabRunStatus.Preparing,
        executor,
        jobId: null,
        baseBranch,
        ...pr,
      }),
    );

    return { run, prepared: this.prepare(run, project, input, baseBranch) };
  }

  // Snapshot of the base branch → parcel (the task is the manifest) → Storage → Worker job.
  private async prepare(
    run: LabRun,
    project: LabProject,
    input: LabStartInput,
    baseBranch: string,
  ): Promise<LabRun> {
    const { userId, title } = run;

    try {
      const github = githubFor(project);
      const baseSha = await readStep(`ветка ${baseBranch}`, () =>
        github.getBranchSha(baseBranch),
      );
      const snapshot = await this.snapshotFor(project, baseSha);
      const baseline = snapshot.baseline;
      const { buffer } = await buildIssueParcel(
        parcelEntries(snapshot),
        {
          number: 'lab',
          title,
          body: `${taskWithSkipped(input.task, snapshot.skipped)}\n\n${labEnvironment(project.repo, baseBranch)}`,
          repo: project.repo,
          baseBranch,
        },
        new Date(),
        baseline,
      );
      const stored = await this.storage.createFromBuffer(
        userId,
        buffer,
        `lab-${project.id}.subscription.zip`,
        {
          channel: 'issue',
          taskKey: `lab:${project.id}`,
          direction: StoredFileDirection.Outbound,
        },
      );
      const job = await this.workers.create(userId, {
        sourceFileId: stored.id,
        model: input.model as JobModel,
        ...(input.contextId ? { contextId: input.contextId } : {}),
        ...(requiredCapabilityOf(run.executor)
          ? { requiredCapability: requiredCapabilityOf(run.executor)! }
          : {}),
      });

      run.status = LabRunStatus.Queued;
      run.jobId = job.id;
      run.baseSha = baseSha;
      run.baseline = JSON.stringify(baseline);

      return await this.runs.save(run);
    } catch (error) {
      await this.runs
        .update(
          { id: run.id },
          {
            status: LabRunStatus.Failed,
            error: message(error),
            finishedAt: new Date(),
          },
        )
        .catch((updateError) =>
          this.logger.warn(
            `Lab run ${run.id} could not be marked failed: ${message(updateError)}`,
          ),
        );

      throw error;
    }
  }

  // The key carries updatedAt, so a changed token or branch never reuses an older download.
  private async snapshotFor(
    project: LabProject,
    baseSha: string,
  ): Promise<LabSnapshot> {
    const key = `${project.id}:${project.updatedAt?.getTime()}:${baseSha}`;

    return this.snapshots.get(key, async () =>
      selectLabSnapshot(
        await readZipball(
          await readStep('скачивание репозитория', () =>
            downloadRepoZip(project.repo, project.token, baseSha),
          ),
        ),
      ),
    );
  }

  async cancel(id: number, userId: number): Promise<LabRun> {
    const run = await this.findOwned(id, userId);

    if (!ACTIVE_LAB_RUN_STATUSES.includes(run.status)) return run;
    if (run.status === LabRunStatus.Publishing) {
      throw new ConflictException(
        'Результат уже публикуется — остановить нельзя',
      );
    }

    const res = await this.runs.update(
      { id, status: In([LabRunStatus.Queued, LabRunStatus.Running]) },
      { status: LabRunStatus.Cancelled, finishedAt: new Date() },
    );

    if (res.affected === 1 && run.jobId)
      await this.workers.cancel(run.jobId, userId);

    return (await this.runs.findOne({ where: { id } })) ?? run;
  }

  // A publish that failed after the worker had succeeded is repeated from the kept result — no new job.
  async retryPublish(id: number, userId: number): Promise<LabRun> {
    const run = await this.findOwned(id, userId);

    if (run.status !== LabRunStatus.Failed || !run.jobId) {
      throw new ConflictException(
        'Повторить публикацию можно только для запуска в статусе «ошибка»',
      );
    }

    const job = await this.workers.findOwned(run.jobId, userId);

    if (job.status !== JobStatus.Succeeded || !job.resultFileId) {
      throw new ConflictException('Задача worker не дала результата');
    }

    const claim = await this.runs.update(
      { id, status: LabRunStatus.Failed },
      { status: LabRunStatus.Publishing, error: null, finishedAt: null },
    );

    if (claim.affected !== 1)
      throw new ConflictException('Публикация уже повторяется');

    run.status = LabRunStatus.Publishing;
    await this.publisher.publish(run, job.resultFileId);

    return run;
  }

  @Interval(ADVANCE_EVERY_MS)
  async advance(): Promise<void> {
    if (this.advancing) return;

    this.advancing = true;

    try {
      // A restart in the middle of publishing leaves the run claimed forever otherwise.
      await this.runs
        .createQueryBuilder()
        .update()
        .set({
          status: LabRunStatus.Failed,
          error: 'Публикация прервана перезапуском — повторите её',
          finishedAt: new Date(),
        })
        .where('status = :status AND "updatedAt" < :before', {
          status: LabRunStatus.Publishing,
          before: new Date(Date.now() - PUBLISHING_STALE_MS),
        })
        .execute();
      await this.runs
        .createQueryBuilder()
        .update()
        .set({
          status: LabRunStatus.Failed,
          error: 'Подготовка прервана перезапуском — запустите задачу снова',
          finishedAt: new Date(),
        })
        .where('status = :status AND "updatedAt" < :before', {
          status: LabRunStatus.Preparing,
          before: new Date(Date.now() - PREPARING_STALE_MS),
        })
        .execute();

      const active = await this.runs.find({
        where: { status: In([LabRunStatus.Queued, LabRunStatus.Running]) },
      });
      const jobIds = active
        .map((run) => run.jobId)
        .filter((id): id is number => id !== null);

      if (jobIds.length === 0) return;

      const jobs = new Map(
        (await this.workers.findStatuses(jobIds)).map((job) => [job.id, job]),
      );

      for (const run of active) {
        await this.advanceOne(
          run,
          run.jobId ? jobs.get(run.jobId) : undefined,
        ).catch((error) =>
          this.logger.warn(
            `Lab run ${run.id} could not be advanced: ${message(error)}`,
          ),
        );
      }
    } finally {
      this.advancing = false;
    }
  }

  async advanceOne(run: LabRun, job: JobStatusRow | undefined): Promise<void> {
    if (!job || job.userId !== run.userId) {
      await this.publisher.finish(run, LabRunStatus.Failed, {
        error: 'Задача worker не найдена',
      });

      return;
    }

    if (job.status === JobStatus.Succeeded) {
      const claim = await this.runs.update(
        { id: run.id, status: In([LabRunStatus.Queued, LabRunStatus.Running]) },
        { status: LabRunStatus.Publishing },
      );

      if (claim.affected === 1) {
        run.status = LabRunStatus.Publishing;
        await this.publisher.publish(run, job.resultFileId);
      }

      return;
    }
    if (job.status === JobStatus.Failed) {
      // A worker restart already re-queued the job: follow the retry instead of reporting a false failure.
      const retry = (await this.workers.findRetriesOf([job.id])).get(job.id);

      if (retry && retry.userId === run.userId) {
        await this.runs.update(
          { id: run.id, status: run.status },
          {
            jobId: retry.id,
            status: LabRunStatus.Queued,
            error: null,
            finishedAt: null,
          },
        );

        return;
      }

      await this.publisher.finish(run, LabRunStatus.Failed, {
        error: job.errorMessage ?? 'Задача worker завершилась ошибкой',
      });
    } else if (job.status === JobStatus.Cancelled) {
      await this.publisher.finish(run, LabRunStatus.Cancelled, {
        note: 'Задача worker остановлена',
      });
    } else {
      const next =
        job.status === JobStatus.Running
          ? LabRunStatus.Running
          : LabRunStatus.Queued;

      if (run.status !== next) await this.runs.update(run.id, { status: next });
    }
  }

  private async findOwned(id: number, userId: number): Promise<LabRun> {
    const run = await this.runs.findOne({ where: { id, userId } });

    if (!run) throw new NotFoundException('Run not found');

    return run;
  }
}
