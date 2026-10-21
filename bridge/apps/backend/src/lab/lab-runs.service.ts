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

import {
  mapInBatches,
  message,
  requireImproveModel,
} from '../improve/improve-shared';
import {
  buildIssueParcel,
  Change,
  describeChanges,
  diffResult,
  readZipball,
} from '../improve/parcel';
import { ContextService } from '../context/context.service';
import { TreeEntry } from '../loop/github-api.service';
import { StoredFileDirection } from '../storage/entities/stored-file.entity';
import { StorageService } from '../storage/storage.service';
import { NotifyService } from '../telegram/notify.service';
import { JobModel, JobStatus } from '../worker/entities/job.entity';
import { JobStatusRow, WorkerService } from '../worker/worker.service';
import {
  ACTIVE_LAB_RUN_STATUSES,
  LabRun,
  LabRunStatus,
  LabTrigger,
} from './entities/lab-run.entity';
import {
  describeGithubError,
  downloadRepoZip,
  githubFor,
  readStep,
  ZIP_TOTAL_MS,
} from './lab-github';
import { LabProject } from './entities/lab-project.entity';
import { LabProjectsService } from './lab-projects.service';
import {
  LAB_MAX_CHANGED_BYTES,
  LAB_MAX_CHANGED_FILES,
  parcelEntries,
  readLabResult,
  LabSnapshot,
  selectLabSnapshot,
  splitBaseline,
  taskWithSkipped,
  withBinaries,
} from './lab-result';

const ADVANCE_EVERY_MS = 15_000;
const BLOB_CONCURRENCY = 6;
// Lab never touches CI/deploy definitions or git internals of somebody else's repository.
const BLOCKED = [/^\.github\/workflows\//, /^\.git\//];
// A run claimed for publishing and untouched this long was lost to a restart.
const PUBLISHING_STALE_MS = 10 * 60_000;
// Same lifetime and bound as Improve's handoff cache.
const SNAPSHOT_CACHE_TTL_MS = 10 * 60 * 1000;
const SNAPSHOT_CACHE_SIZE = 2;
// A run still preparing after the longest possible download plus a margin was lost to a restart.
const PREPARING_STALE_MS = ZIP_TOTAL_MS + 5 * 60_000;

export function titleOf(task: string): string {
  const line = task.trim().split('\n')[0].trim();

  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'task'
  );
}

export function isBlocked(path: string): boolean {
  return BLOCKED.some((pattern) => pattern.test(path));
}

@Injectable()
export class LabRunsService {
  private readonly logger = new Logger(LabRunsService.name);
  private advancing = false;
  // Recent repo snapshots (oldest first) and the ones being built right now, so consecutive or
  // concurrent starts on one project + base SHA download the repository once.
  private readonly snapshotCache = new Map<
    string,
    { snapshot: LabSnapshot; at: number }
  >();
  private readonly snapshotPending = new Map<string, Promise<LabSnapshot>>();

  constructor(
    @InjectRepository(LabRun)
    private readonly runs: Repository<LabRun>,
    private readonly projects: LabProjectsService,
    private readonly workers: WorkerService,
    private readonly storage: StorageService,
    private readonly contexts: ContextService,
    private readonly notifier: NotifyService,
  ) {}

  list(userId: number, limit = 50): Promise<LabRun[]> {
    return this.runs.find({
      where: { userId },
      order: { id: 'DESC' },
      take: limit,
    });
  }

  // Snapshot of the base branch → parcel (the task is the manifest) → Storage → Worker job.
  async start(
    userId: number,
    input: {
      projectId: number;
      task: string;
      model: string;
      contextId?: number | null;
    },
    trigger: LabTrigger = 'manual',
    scheduleId: number | null = null,
  ): Promise<LabRun> {
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

    const title = titleOf(input.task);
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
        jobId: null,
      }),
    );

    try {
      const github = githubFor(project);
      const baseSha = await readStep(`ветка ${project.baseBranch}`, () =>
        github.getBranchSha(project.baseBranch),
      );
      const snapshot = await this.snapshotFor(project, baseSha);
      const baseline = snapshot.baseline;
      const { buffer } = await buildIssueParcel(
        parcelEntries(snapshot),
        {
          number: 'lab',
          title,
          body: taskWithSkipped(input.task, snapshot.skipped),
          repo: project.repo,
          baseBranch: project.baseBranch,
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
    const cached = this.snapshotCache.get(key);

    if (cached && Date.now() - cached.at < SNAPSHOT_CACHE_TTL_MS)
      return cached.snapshot;

    const pending = this.snapshotPending.get(key);

    if (pending) return pending;

    const promise = (async () => {
      const snapshot = selectLabSnapshot(
        await readZipball(
          await readStep('скачивание репозитория', () =>
            downloadRepoZip(project.repo, project.token, baseSha),
          ),
        ),
      );

      this.snapshotCache.delete(key);
      this.snapshotCache.set(key, { snapshot, at: Date.now() });
      while (this.snapshotCache.size > SNAPSHOT_CACHE_SIZE)
        this.snapshotCache.delete(this.snapshotCache.keys().next().value!);

      return snapshot;
    })();

    this.snapshotPending.set(key, promise);

    try {
      return await promise;
    } finally {
      this.snapshotPending.delete(key);
    }
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
    await this.publish(run, job.resultFileId);

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
      await this.finish(run, LabRunStatus.Failed, {
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
        await this.publish(run, job.resultFileId);
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

      await this.finish(run, LabRunStatus.Failed, {
        error: job.errorMessage ?? 'Задача worker завершилась ошибкой',
      });
    } else if (job.status === JobStatus.Cancelled) {
      await this.finish(run, LabRunStatus.Cancelled, {
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

  // result parcel → diff against the baseline → branch → pull request. Never merges.
  async publish(run: LabRun, resultFileId: number | null): Promise<void> {
    try {
      if (!resultFileId) throw new Error('У задачи worker нет результата');
      if (!run.projectId) throw new Error('Проект отключён от Lab');

      const project = await this.projects.findOwned(run.projectId, run.userId);
      const stored = await this.runs.findOne({
        where: { id: run.id },
        select: { id: true, baseline: true },
      });
      const file = await this.storage.findOwned(resultFileId, run.userId);
      const result = await readLabResult(await this.storage.readBytes(file));
      const baseline = splitBaseline(
        JSON.parse(stored?.baseline ?? '{}') as Record<string, string>,
      );
      const changes = withBinaries(
        diffResult(baseline.text, result.files),
        result.binaries,
        baseline.binaries,
      );
      const dropped = changes
        .filter((change) => isBlocked(change.path))
        .map((change) => change.path);
      const allowed = changes.filter((change) => !isBlocked(change.path));
      const note = dropped.length
        ? `Отброшены изменения защищённых путей: ${dropped.join(', ')}`
        : null;

      if (allowed.length === 0) {
        await this.finish(run, LabRunStatus.NoChanges, {
          note: note ?? 'Worker ничего не изменил',
        });
        await this.notifier.send(
          `ℹ️ Lab «${run.title}» (${run.repo}): worker не внёс изменений — PR не нужен`,
        );

        return;
      }
      if (allowed.length > LAB_MAX_CHANGED_FILES)
        throw new Error(
          `Слишком много изменённых файлов (${allowed.length} > ${LAB_MAX_CHANGED_FILES})`,
        );

      const size = allowed.reduce(
        (sum, change) => sum + (change.bytes?.length ?? 0),
        0,
      );

      if (size > LAB_MAX_CHANGED_BYTES)
        throw new Error(
          `Слишком большой результат (${Math.round(size / 1024 / 1024)} МБ из допустимых ${LAB_MAX_CHANGED_BYTES / 1024 / 1024})`,
        );

      const github = githubFor(project);
      const baseSha = run.baseSha as string;
      const commit = await github.createCommit(
        `${run.title}\n\nAutomated by bridge Lab (run ${run.id}, ${run.model}).`,
        await this.createTree(github, baseSha, allowed),
        baseSha,
      );
      const branch = `lab/run-${run.id}-${slug(run.title)}`;

      await github.createBranch(branch, commit);

      let pull: { number: number; htmlUrl: string };

      try {
        pull = await github.createPull({
          title: run.title,
          head: branch,
          base: project.baseBranch,
          body: [
            run.task,
            '',
            `Automated by bridge Lab (run ${run.id}, model ${run.model}, trigger ${run.trigger}): ${describeChanges(allowed)}.`,
            ...(note ? ['', `⚠️ ${note}`] : []),
            '',
            'Не влито автоматически — проверьте и влейте как обычно.',
          ].join('\n'),
        });
      } catch (error) {
        // A branch with no pull request helps nobody, and every retry would leave another one behind.
        await github.deleteBranch(branch).catch(() => undefined);
        throw error;
      }

      await this.finish(run, LabRunStatus.PrOpen, {
        branch,
        prNumber: pull.number,
        prUrl: pull.htmlUrl,
        note: [describeChanges(allowed), note].filter(Boolean).join('. '),
      });
      await this.storage.delete(file).catch(() => undefined);
      await this.notifier.send(
        `🔀 Lab «${run.title}» → PR #${pull.number} в ${run.repo} (${describeChanges(allowed)})\n${pull.htmlUrl}`,
      );
    } catch (error) {
      const reason = describeGithubError(error);

      await this.finish(run, LabRunStatus.Failed, { error: reason });
      await this.notifier.send(
        `🔴 Lab «${run.title}» (${run.repo}): не удалось открыть PR — ${reason.slice(0, 200)}`,
      );
    }
  }

  private async createTree(
    github: ReturnType<typeof githubFor>,
    baseSha: string,
    changes: Change[],
  ): Promise<string> {
    const baseTree = await github.getCommitTreeSha(baseSha);
    const tree = await mapInBatches(
      changes,
      BLOB_CONCURRENCY,
      async (change): Promise<TreeEntry> => ({
        path: change.path,
        mode: '100644',
        type: 'blob',
        sha:
          change.kind === 'deleted'
            ? null
            : await github.createBlob(change.bytes as Uint8Array),
      }),
    );

    return github.createTree(baseTree, tree);
  }

  async finish(
    run: LabRun,
    status: LabRunStatus,
    patch: Partial<
      Pick<LabRun, 'error' | 'note' | 'branch' | 'prNumber' | 'prUrl'>
    >,
  ): Promise<void> {
    Object.assign(run, patch, { status, finishedAt: new Date() });
    // `baseline` is not selected by default, so a plain save would not touch it; update only what changed.
    await this.runs.update(run.id, {
      ...patch,
      status,
      finishedAt: run.finishedAt,
    });
  }

  private async findOwned(id: number, userId: number): Promise<LabRun> {
    const run = await this.runs.findOne({ where: { id, userId } });

    if (!run) throw new NotFoundException('Run not found');

    return run;
  }
}
