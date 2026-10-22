import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  In,
  IsNull,
  LessThan,
  MoreThan,
  Not,
  Repository,
} from 'typeorm';

import { AppLogService } from '../logs/app-log.service';
import { GithubApiService } from '../loop/github-api.service';
import { MergeService } from '../loop/merge.service';
import { StorageService } from '../storage/storage.service';
import { NotifyService } from '../telegram/notify.service';
import { JobStatus } from '../worker/entities/job.entity';
import { JobStatusRow, WorkerService } from '../worker/worker.service';
import {
  ACTIVE_RUN_STATUSES,
  ImproveRun,
  ImproveRunStatus,
  ImproveTrigger,
} from './entities/improve-run.entity';
import {
  DEFAULT_CATEGORIES,
  AnalysisCategory,
  BACKLOG_FILE,
  buildAnalysisPrompt,
  buildLogDigest,
  categoryLabel,
  isCategory,
  parseBacklog,
  pickOnePerCategory,
} from './analysis';
import { ImproveHandoffService } from './improve-handoff.service';
import { ImproveIssueFilingService } from './improve-issue-filing.service';
import { ImprovePublishService } from './improve-publish.service';
import {
  AnalysisResult,
  mapInBatches,
  IMPROVE_MODELS,
  message,
  PR_LABEL,
  requireImproveModel,
} from './improve-shared';
import { withDefinitionOfDone } from './definition-of-done';
import { MAX_REPAIRS_PER_PR, prFixBody, repairBody } from './repair';
import { readResultParcel, utf8Text } from './parcel';

const LOG_DIGEST_DAYS = 7;
const LOG_DIGEST_ROWS = 300;
export const ADVANCE_EVERY_MS = 15_000;
// How long after failing a run still follows a retry of its job from the Worker page.
const RETRY_FOLLOW_MS = 3 * 24 * 60 * 60 * 1000;
// A run claimed for publishing and untouched this long was lost to a restart.
const PUBLISHING_STALE_MS = 10 * 60_000;
const PUBLISH_ABANDONED_ERROR =
  'Публикация прервана (bridge перезапускался); запустите задачу заново';
export const AUTOSTART_MIN_AGE_SECONDS = 10;

// The loop run on bridge itself: pick a GitHub issue, hand the repository snapshot
// and the issue to a worker, and turn what comes back into a branch and a pull
// request — no reports, no developer machine. Merging stays where it always was
// (the loop's CI → Telegram → Merge flow); this only ever opens PRs.
@Injectable()
export class ImproveService {
  private readonly logger = new Logger(ImproveService.name);
  private advancing = false;
  // Keys of starts in flight ('analysis', `issue:${n}`, `pr:${n}`). The DB check for an
  // active run happens long before the run row is saved, so concurrent starts
  // would all pass it. In-process only: this relies on a single bridge replica.
  private readonly starting = new Set<string>();

  constructor(
    @InjectRepository(ImproveRun)
    private readonly runs: Repository<ImproveRun>,
    private readonly github: GithubApiService,
    private readonly mergeService: MergeService,
    private readonly storage: StorageService,
    private readonly workers: WorkerService,
    private readonly notifier: NotifyService,
    private readonly dataSource: DataSource,
    private readonly appLogs: AppLogService,
    private readonly issueFiling: ImproveIssueFilingService,
    private readonly publisher: ImprovePublishService,
    private readonly handoff: ImproveHandoffService,
  ) {}

  // ---------------------------------------------------------------- status

  status() {
    return {
      configured: this.github.isReady(),
      repo: this.github.repoName() ?? null,
      baseBranch: this.github.baseBranch(),
      label: PR_LABEL,
      models: IMPROVE_MODELS,
    };
  }

  // The open `loop` issues, each with its latest run (if any), for the page.
  // `all` lists every open issue, labelled or not.
  async listIssues(label = PR_LABEL, all = false) {
    this.requireConfigured();

    const issues = await this.github.listOpenIssues(all ? '' : label, 100);
    const latest = new Map<number, Omit<ImproveRun, 'result' | 'baseline'>>();

    if (issues.length) {
      // Only the newest run per issue, without the heavy `result`/`baseline`.
      const columns = this.runs.metadata.columns
        .filter((c) => !['result', 'baseline'].includes(c.propertyName))
        .map((c) => `run.${c.propertyName}`);
      const runs = await this.runs
        .createQueryBuilder('run')
        .select(columns)
        .distinctOn(['run.issueNumber'])
        .where('run.kind = :kind', { kind: 'issue' })
        .andWhere('run.issueNumber IN (:...numbers)', {
          numbers: issues.map((issue) => issue.number),
        })
        .orderBy('run.issueNumber')
        .addOrderBy('run.id', 'DESC')
        .getMany();

      for (const run of runs) {
        if (run.issueNumber != null) latest.set(run.issueNumber, run);
      }
    }

    return issues.map((issue) => ({
      ...issue,
      run: latest.get(issue.number) ?? null,
    }));
  }

  // The list is polled, so it leaves out `result` (the whole analysis JSON) and
  // reports only whether there is one; getRun returns the full row.
  async listRuns(
    limit = 50,
  ): Promise<(Omit<ImproveRun, 'result'> & { hasResult: boolean })[]> {
    const columns = this.runs.metadata.columns
      .filter((c) => !['result', 'baseline'].includes(c.propertyName))
      .map((c) => `run.${c.propertyName}`);
    const { entities, raw } = await this.runs
      .createQueryBuilder('run')
      .select(columns)
      .addSelect('run.result IS NOT NULL', 'hasResult')
      .orderBy('run.id', 'DESC')
      .limit(Math.min(Math.max(limit, 1), 200))
      .getRawAndEntities<{ hasResult: boolean }>();

    return entities.map((run, i) => ({
      ...run,
      hasResult: Boolean(raw[i].hasResult),
    }));
  }

  async getRun(id: number): Promise<ImproveRun> {
    const run = await this.runs.findOne({ where: { id } });

    if (!run) throw new NotFoundException('Run not found');

    return run;
  }

  // ------------------------------------------------------------- start a run

  async startRun(
    userId: number,
    issueNumber: number,
    model: string,
    trigger: ImproveTrigger = 'manual',
    scheduleId: number | null = null,
    contextId: number | null = null,
  ): Promise<ImproveRun> {
    const key = `issue:${issueNumber}`;

    if (this.starting.has(key)) {
      throw new ConflictException(`Задача #${issueNumber} уже выполняется`);
    }

    this.starting.add(key);

    try {
      return await this.startRunReserved(
        userId,
        issueNumber,
        model,
        trigger,
        scheduleId,
        contextId,
      );
    } finally {
      this.starting.delete(key);
    }
  }

  private async startRunReserved(
    userId: number,
    issueNumber: number,
    model: string,
    trigger: ImproveTrigger,
    scheduleId: number | null,
    contextId: number | null,
  ): Promise<ImproveRun> {
    this.requireConfigured();
    this.requireModel(model);

    const blocking = await this.runs.findOne({
      where: {
        kind: 'issue',
        issueNumber,
        status: In([...ACTIVE_RUN_STATUSES, ImproveRunStatus.PrOpen]),
      },
    });

    if (blocking) {
      throw new ConflictException(
        blocking.status === ImproveRunStatus.PrOpen
          ? `Для задачи #${issueNumber} уже открыт PR #${blocking.prNumber}`
          : `Задача #${issueNumber} уже выполняется`,
      );
    }

    // The base snapshot does not depend on the issue: fetch both together. A
    // not-open issue is still rejected before any file or job is created.
    const [issue, prepared] = await Promise.all([
      this.github.getIssue(issueNumber),
      this.handoff.prepareSnapshot(),
    ]);

    if (issue.isPull || issue.state !== 'open') {
      throw new BadRequestException(`#${issueNumber} — не открытая задача`);
    }

    const { job, baseSha, baseline, fileCount } =
      await this.handoff.handToWorker(
        userId,
        model,
        {
          number: issue.number,
          title: issue.title,
          body: withDefinitionOfDone(issue.body),
        },
        `improve:${issue.number}`,
        `improve-${issue.number}.subscription.zip`,
        undefined,
        prepared,
        contextId,
      );

    const run = await this.runs.save(
      this.runs.create({
        userId,
        kind: 'issue',
        issueNumber: issue.number,
        issueTitle: issue.title.slice(0, 255),
        model,
        trigger,
        scheduleId,
        status: ImproveRunStatus.Queued,
        jobId: job.id,
        baseSha,
        baseline: JSON.stringify(baseline),
      }),
    );

    this.log(
      'info',
      'improve.run_started',
      `Run ${run.id}: issue #${issue.number} → job ${job.id} (${model}, ${trigger})`,
      {
        runId: run.id,
        jobId: job.id,
        files: fileCount,
      },
    );

    return run;
  }

  // CI went red on an open Improve PR: a worker gets the PR's branch as it is now, with the failing
  // checks in front of it. Its result becomes a new commit on that same branch (publishRepair) — no
  // new PR, and CI runs again on the push.
  async startRepair(
    parent: ImproveRun,
    pull: { number: number; headSha: string; branch: string },
    failures: string,
  ): Promise<ImproveRun> {
    return this.withPrReserved(pull.number, () =>
      this.startRepairReserved(parent, pull, failures),
    );
  }

  private async startRepairReserved(
    parent: ImproveRun,
    pull: { number: number; headSha: string; branch: string },
    failures: string,
  ): Promise<ImproveRun> {
    this.requireConfigured();

    const attempt =
      (await this.runs.count({
        where: { kind: 'repair', prNumber: pull.number, trigger: 'ci' },
      })) + 1;
    const { job, baseSha, baseline, fileCount } =
      await this.handoff.handToWorker(
        parent.userId,
        parent.model,
        {
          number: parent.issueNumber as number,
          title: `Fix CI on PR #${pull.number}: ${parent.issueTitle}`,
          body: withDefinitionOfDone(
            repairBody({
              prNumber: pull.number,
              branch: pull.branch,
              issueNumber: parent.issueNumber,
              issueTitle: parent.issueTitle,
              attempt,
              failures,
            }),
          ),
        },
        `improve:${parent.issueNumber}:repair:${attempt}`,
        `improve-${parent.issueNumber}-repair-${attempt}.subscription.zip`,
        { sha: pull.headSha, branch: pull.branch },
      );
    const run = await this.runs.save(
      this.runs.create({
        userId: parent.userId,
        kind: 'repair',
        issueNumber: parent.issueNumber,
        issueTitle: parent.issueTitle,
        model: parent.model,
        trigger: 'ci',
        status: ImproveRunStatus.Queued,
        jobId: job.id,
        baseSha,
        baseline: JSON.stringify(baseline),
        branch: pull.branch,
        prNumber: pull.number,
        prUrl: parent.prUrl,
        note: `Автоисправление CI, попытка ${attempt} из ${MAX_REPAIRS_PER_PR}`,
      }),
    );

    this.log(
      'info',
      'improve.repair_started',
      `Run ${run.id}: CI repair ${attempt}/${MAX_REPAIRS_PER_PR} for PR #${pull.number} → job ${job.id} (${parent.model})`,
      { runId: run.id, jobId: job.id, prNumber: pull.number, files: fileCount },
    );

    return run;
  }

  // "Fix this PR", asked for from the chat and confirmed by the person there: a worker gets the PR's
  // branch as it is now and the request in front of it; its result becomes a new commit on that same
  // branch (publishRepair path), never a new PR and never a force-push. Protected paths are dropped
  // at publish like for every other run.
  async startPrFix(
    userId: number,
    prNumber: number,
    instruction: string,
    model: string,
  ): Promise<ImproveRun> {
    return this.withPrReserved(prNumber, () =>
      this.startPrFixReserved(userId, prNumber, instruction, model),
    );
  }

  // One start per PR at a time (chat change or CI repair): like startRun's issue key — the
  // active-repair count only sees a run once it is saved, after the slow handoff.
  private async withPrReserved<T>(
    prNumber: number,
    start: () => Promise<T>,
  ): Promise<T> {
    const key = `pr:${prNumber}`;

    if (this.starting.has(key)) {
      throw new ConflictException(`PR #${prNumber} уже исправляется`);
    }

    this.starting.add(key);

    try {
      return await start();
    } finally {
      this.starting.delete(key);
    }
  }

  private async startPrFixReserved(
    userId: number,
    prNumber: number,
    instruction: string,
    model: string,
  ): Promise<ImproveRun> {
    this.requireConfigured();
    this.requireModel(model);

    const active = await this.runs.count({
      where: {
        kind: 'repair',
        prNumber,
        status: In(ACTIVE_RUN_STATUSES),
      },
    });

    if (active > 0) {
      throw new ConflictException(`PR #${prNumber} уже исправляется`);
    }

    const pull = await this.github.getPull(prNumber);

    if (pull.state !== 'open' || pull.merged) {
      throw new BadRequestException(`PR #${prNumber} не открыт`);
    }

    if (!pull.headRepo || pull.headRepo !== this.github.repoName()) {
      throw new BadRequestException(
        `PR #${prNumber} из другого репозитория — в его ветку нельзя отправить изменения`,
      );
    }

    const attempt =
      (await this.runs.count({
        where: { kind: 'repair', prNumber, trigger: 'chat' },
      })) + 1;
    const { job, baseSha, baseline, fileCount } =
      await this.handoff.handToWorker(
        userId,
        model,
        {
          number: `pr-${prNumber}`,
          title: `Change PR #${prNumber}: ${pull.title}`,
          body: withDefinitionOfDone(
            prFixBody({
              prNumber,
              prTitle: pull.title,
              branch: pull.headRef,
              instruction,
            }),
          ),
        },
        `improve:pr-${prNumber}:chat:${attempt}`,
        `improve-pr-${prNumber}-chat-${attempt}.subscription.zip`,
        { sha: pull.headSha, branch: pull.headRef },
      );
    const run = await this.runs.save(
      this.runs.create({
        userId,
        kind: 'repair',
        issueNumber: null,
        issueTitle: pull.title.slice(0, 255),
        model,
        trigger: 'chat',
        status: ImproveRunStatus.Queued,
        jobId: job.id,
        baseSha,
        baseline: JSON.stringify(baseline),
        branch: pull.headRef,
        prNumber,
        prUrl: pull.htmlUrl,
        note: `Правка PR из чата: ${instruction.replace(/\s+/g, ' ').trim().slice(0, 150)}`,
      }),
    );

    this.log(
      'info',
      'improve.pr_fix_started',
      `Run ${run.id}: chat change of PR #${prNumber} → job ${job.id} (${model})`,
      { runId: run.id, jobId: job.id, prNumber, files: fileCount },
    );

    return run;
  }

  // The chat's "merge this PR" card, after the person confirmed it — a direct,
  // synchronous GitHub call (no worker job, no ImproveRun row to track).
  async startPrMerge(prNumber: number) {
    const result = await this.mergeService.mergeAny(prNumber);

    this.log(
      'info',
      'improve.pr_merge',
      `PR #${prNumber}: ${result.merged ? 'merged' : `refused (${result.reason})`}`,
      { prNumber, merged: result.merged },
    );

    return result;
  }

  async cancelRun(id: number, userId: number): Promise<ImproveRun> {
    const run = await this.runs.findOne({ where: { id } });

    if (!run) throw new NotFoundException('Run not found');
    if (!ACTIVE_RUN_STATUSES.includes(run.status)) return run;

    if (run.status === ImproveRunStatus.Publishing) {
      throw new ConflictException(
        'The run is already being published and cannot be cancelled',
      );
    }

    // Guarded by status: a run claimed for publishing in between is left alone.
    const res = await this.runs.update(
      {
        id,
        status: In([ImproveRunStatus.Queued, ImproveRunStatus.Running]),
      },
      { status: ImproveRunStatus.Cancelled, finishedAt: new Date() },
    );

    if (res.affected === 1 && run.jobId) {
      await this.workers.cancel(run.jobId, run.userId ?? userId);
    }

    return (await this.runs.findOne({ where: { id } })) ?? run;
  }

  // A publish that failed after the worker had already succeeded (a token without
  // rights, a GitHub outage) is repeated from the kept result parcel — no new job.
  async retryPublish(id: number, userId: number): Promise<ImproveRun> {
    const run = await this.runs.findOne({ where: { id } });

    if (!run) throw new NotFoundException('Run not found');
    if (run.kind === 'analysis' || run.status !== ImproveRunStatus.Failed) {
      throw new ConflictException(
        'Повторить публикацию можно только для запуска в статусе «ошибка»',
      );
    }
    if (!run.jobId) {
      throw new ConflictException('У запуска нет задачи worker');
    }

    const job = await this.workers.findOwned(run.jobId, run.userId ?? userId);

    if (job.status !== JobStatus.Succeeded || !job.resultFileId) {
      throw new ConflictException('Задача worker не дала результата');
    }

    try {
      const file = await this.storage.findOwned(
        job.resultFileId,
        run.userId ?? userId,
      );

      if (!(await this.storage.exists(file))) throw new Error('file is gone');
    } catch {
      throw new ConflictException(
        'Файл результата уже удалён — запустите задачу заново',
      );
    }

    // Claimed exactly once even if the button is pressed twice.
    const claim = await this.runs.update(
      { id: run.id, status: ImproveRunStatus.Failed },
      { status: ImproveRunStatus.Publishing, error: null, finishedAt: null },
    );

    if (claim.affected !== 1) {
      throw new ConflictException('Публикация уже повторяется');
    }

    run.status = ImproveRunStatus.Publishing;
    run.error = null;
    run.finishedAt = null;
    await this.publisher.publish(run, job.resultFileId);

    return run;
  }

  // ------------------------------------------------- follow the jobs, publish

  @Interval(ADVANCE_EVERY_MS)
  async advance(): Promise<void> {
    if (this.advancing) return;

    this.advancing = true;

    try {
      await this.abandonStalePublishing().catch((error) =>
        this.logger.warn(
          `Stale publishing runs could not be checked: ${message(error)}`,
        ),
      );

      await this.followRetriedJobs().catch((error) =>
        this.logger.warn(
          `Retried jobs could not be followed: ${message(error)}`,
        ),
      );

      const active = await this.runs.find({
        where: {
          status: In([ImproveRunStatus.Queued, ImproveRunStatus.Running]),
        },
        order: { id: 'ASC' },
      });

      const jobIds = active.flatMap((run) => (run.jobId ? [run.jobId] : []));
      const statuses = new Map(
        (await this.workers.findStatuses(jobIds)).map((job) => [job.id, job]),
      );

      for (const run of active) {
        await this.advanceOne(
          run,
          run.jobId ? statuses.get(run.jobId) : undefined,
        ).catch((error) =>
          this.logger.warn(
            `Run ${run.id} could not be advanced: ${message(error)}`,
          ),
        );
      }
    } finally {
      this.advancing = false;
    }
  }

  // A run whose job failed (a worker restart, a crash) is over — but the Worker page's "retry" starts a
  // NEW job over the same parcel, and when that one succeeds nothing pointed at it: the job read "done",
  // the run still read "error". So a recently failed run whose job failed or was stopped follows the
  // retry: it is queued again on the newer job, and advances from there as usual.
  private async followRetriedJobs(): Promise<void> {
    const failed = await this.runs.find({
      where: {
        status: ImproveRunStatus.Failed,
        jobId: Not(IsNull()),
        finishedAt: MoreThan(new Date(Date.now() - RETRY_FOLLOW_MS)),
      },
      order: { id: 'ASC' },
    });

    if (failed.length === 0) return;

    const oldIds = failed.map((run) => run.jobId as number);
    const olds = new Map(
      (await this.workers.findStatuses(oldIds)).map((job) => [job.id, job]),
    );
    // Only a failure that came from the job itself: a succeeded job whose publishing failed has "retry publish".
    const stopped = oldIds.filter((id) => {
      const status = olds.get(id)?.status;

      return status === JobStatus.Failed || status === JobStatus.Cancelled;
    });
    const retries = await this.workers.findRetriesOf(stopped);

    for (const run of failed) {
      const retry = retries.get(run.jobId as number);

      if (!retry || retry.userId !== run.userId) continue;

      const moved = await this.runs.update(
        { id: run.id, status: ImproveRunStatus.Failed },
        {
          jobId: retry.id,
          status: ImproveRunStatus.Queued,
          error: null,
          finishedAt: null,
        },
      );

      if (moved.affected === 1) {
        this.log(
          'info',
          'improve.job_retried',
          `Run ${run.id} (issue #${run.issueNumber}): follows the retried job ${retry.id} (was ${run.jobId})`,
          { runId: run.id, jobId: retry.id },
        );
      }
    }
  }

  // Publishing runs in-process, so a restart mid-publish leaves the run claimed for
  // good. The claim bumps `updatedAt`; one untouched for longer than the bound is
  // dead. Not retried on its own: a half-made branch or PR may already exist.
  private async abandonStalePublishing(): Promise<void> {
    const stale = await this.runs.find({
      where: {
        status: ImproveRunStatus.Publishing,
        updatedAt: LessThan(new Date(Date.now() - PUBLISHING_STALE_MS)),
      },
      order: { id: 'ASC' },
    });

    for (const run of stale) {
      await this.publisher.finish(run, ImproveRunStatus.Failed, {
        error: PUBLISH_ABANDONED_ERROR,
      });
      this.log(
        'warn',
        'improve.publish_abandoned',
        `Run ${run.id} (issue #${run.issueNumber}): publishing abandoned after a restart`,
        { runId: run.id, jobId: run.jobId ?? undefined },
      );
    }
  }

  async advanceOne(
    run: ImproveRun,
    job: JobStatusRow | undefined,
  ): Promise<void> {
    if (!run.jobId) return;

    if (!job || job.userId !== run.userId)
      throw new NotFoundException('Job not found');

    if (job.status === JobStatus.Succeeded) {
      // Claimed exactly once even if two ticks overlap.
      const claim = await this.runs.update(
        {
          id: run.id,
          status: In([ImproveRunStatus.Queued, ImproveRunStatus.Running]),
        },
        { status: ImproveRunStatus.Publishing },
      );

      if (claim.affected === 1) {
        run.status = ImproveRunStatus.Publishing;

        if (run.kind === 'analysis')
          await this.finishAnalysis(run, job.resultFileId);
        else await this.publisher.publish(run, job.resultFileId);
      }

      return;
    }

    if (job.status === JobStatus.Failed) {
      // A worker restart already re-queued the job: go straight onto the retry instead of a false failure.
      const retry = (await this.workers.findRetriesOf([job.id])).get(job.id);

      if (retry && retry.userId === run.userId) {
        const moved = await this.runs.update(
          { id: run.id, status: run.status },
          {
            jobId: retry.id,
            status: ImproveRunStatus.Queued,
            error: null,
            finishedAt: null,
          },
        );

        if (moved.affected === 1) {
          this.log(
            'info',
            'improve.job_retried',
            `Run ${run.id} (issue #${run.issueNumber}): follows the retried job ${retry.id} (was ${run.jobId})`,
            { runId: run.id, jobId: retry.id },
          );
        }

        return;
      }

      await this.publisher.finish(run, ImproveRunStatus.Failed, {
        error: job.errorMessage ?? 'Задача worker завершилась ошибкой',
      });
    } else if (job.status === JobStatus.Cancelled) {
      await this.publisher.finish(run, ImproveRunStatus.Cancelled, {
        note: 'Задача worker остановлена',
      });
    } else {
      const next =
        job.status === JobStatus.Running
          ? ImproveRunStatus.Running
          : ImproveRunStatus.Queued;

      if (run.status !== next) await this.runs.update(run.id, { status: next });
    }
  }

  // -------------------------------------------------------------- analysis

  // A worker reads the repository and proposes one improvement per direction. The
  // proposals are filed as GitHub issues (labelled `loop`) right away when
  // `autoCreate`, otherwise kept on the run for review.
  async startAnalysis(
    userId: number,
    model: string,
    categories: AnalysisCategory[] = DEFAULT_CATEGORIES,
    autoCreate = false,
    trigger: ImproveTrigger = 'manual',
    scheduleId: number | null = null,
    autoStart = false,
    contextId: number | null = null,
  ): Promise<ImproveRun> {
    if (this.starting.has('analysis')) {
      throw new ConflictException('Анализ уже выполняется');
    }

    this.starting.add('analysis');

    try {
      return await this.startAnalysisReserved(
        userId,
        model,
        categories,
        autoCreate,
        trigger,
        scheduleId,
        autoStart,
        contextId,
      );
    } finally {
      this.starting.delete('analysis');
    }
  }

  private async startAnalysisReserved(
    userId: number,
    model: string,
    categories: AnalysisCategory[],
    autoCreate: boolean,
    trigger: ImproveTrigger,
    scheduleId: number | null,
    autoStart: boolean,
    contextId: number | null,
  ): Promise<ImproveRun> {
    this.requireConfigured();
    this.requireModel(model);

    if (categories.length === 0 || !categories.every(isCategory)) {
      throw new BadRequestException(
        'Выберите хотя бы одно направление анализа',
      );
    }

    const active = await this.runs.findOne({
      where: { kind: 'analysis', status: In(ACTIVE_RUN_STATUSES) },
    });

    if (active) {
      throw new ConflictException('Анализ уже выполняется');
    }

    const started = Date.now();
    const timed = async <T>(work: Promise<T>) => {
      const value = await work;

      return { value, ms: Date.now() - started };
    };
    const [titlesStep, digestStep, prepStep] = await Promise.all([
      timed(this.github.listIssueTitles()),
      timed(this.logDigest()),
      timed(this.handoff.prepareSnapshot()),
    ]);
    const titles = titlesStep.value.map((issue) => issue.title);
    const date = new Date().toISOString().slice(0, 10);
    const { job, baseSha, fileCount } = await this.handoff.handToWorker(
      userId,
      model,
      {
        number: `analysis-${date}`,
        title: `Analysis ${date}`,
        body: buildAnalysisPrompt(titles, categories, digestStep.value),
      },
      'improve:analysis',
      `improve-analysis-${date}.subscription.zip`,
      undefined,
      prepStep.value,
      contextId,
    );
    const run = await this.runs.save(
      this.runs.create({
        userId,
        kind: 'analysis',
        issueNumber: null,
        issueTitle: `Анализ: ${categories.map(categoryLabel).join(', ')}`.slice(
          0,
          255,
        ),
        model,
        trigger,
        scheduleId,
        status: ImproveRunStatus.Queued,
        jobId: job.id,
        baseSha,
        result: JSON.stringify({
          categories,
          autoCreate,
          autoStart,
          items: [],
        }),
      }),
    );

    this.log(
      'info',
      'improve.analysis_started',
      `Run ${run.id}: analysis (${categories.join(', ')}) → job ${job.id} (${model}, ${trigger})`,
      {
        runId: run.id,
        jobId: job.id,
        files: fileCount,
        phaseMs: {
          titles: titlesStep.ms,
          logDigest: digestStep.ms,
          snapshot: prepStep.ms,
          total: Date.now() - started,
        },
      },
    );

    return run;
  }

  // What the system's own logs say lately (Profile → Logs). Best-effort: an
  // analysis must still run when the log table is unavailable or empty.
  private async logDigest(): Promise<string> {
    try {
      const [summary, recent] = await Promise.all([
        this.appLogs.summary(LOG_DIGEST_DAYS),
        this.appLogs.list({
          days: LOG_DIGEST_DAYS,
          levels: ['warn', 'error'],
          limit: LOG_DIGEST_ROWS,
        }),
      ]);

      return buildLogDigest(summary, recent, LOG_DIGEST_ROWS);
    } catch (error) {
      this.logger.warn(`Log digest skipped: ${message(error)}`);

      return '';
    }
  }

  // The worker's backlog → one proposal per direction → (optionally) GitHub issues.
  async finishAnalysis(
    run: ImproveRun,
    resultFileId: number | null,
  ): Promise<void> {
    try {
      if (!resultFileId) throw new Error('У задачи worker нет результата');

      const file = await this.storage.findOwned(resultFileId, run.userId);
      const result = await readResultParcel(await this.storage.readBytes(file));
      const raw = result.get(BACKLOG_FILE);

      if (!raw) throw new Error(`Worker не создал ${BACKLOG_FILE}`);

      const stored = JSON.parse(run.result ?? '{}') as AnalysisResult;
      const items = pickOnePerCategory(
        parseBacklog(utf8Text(raw)),
        stored.categories ?? DEFAULT_CATEGORIES,
      );

      if (items.length === 0) {
        await this.publisher.finish(run, ImproveRunStatus.Analyzed, {
          result: JSON.stringify({ ...stored, items: [] }),
          note: 'Анализ ничего не предложил',
        });
        await this.notifier.send('ℹ️ Анализ завершён: предложений нет');
        await this.storage.delete(file).catch(() => undefined);

        return;
      }

      run.result = JSON.stringify({ ...stored, items });

      let summary: string | null = null;

      if (stored.autoCreate) {
        try {
          summary = await this.issueFiling.fileProposals(run);
        } catch (error) {
          // The proposals exist; only the filing failed — the manual button can finish it.
          const note = `${items.length} предложений ждут проверки; автосоздание issues прервано: ${message(error)}`;

          await this.publisher.finish(run, ImproveRunStatus.Analyzed, {
            result: run.result,
            note,
          });
          await this.storage.delete(file).catch(() => undefined);
          await this.notifier.send(
            `⚠️ Анализ завершён, но issues созданы не все: ${message(error).slice(0, 200)}`,
          );

          return;
        }
      }

      if (summary && stored.autoStart) {
        summary += `; ${await this.startFiled(run)}`;
      }

      await this.publisher.finish(run, ImproveRunStatus.Analyzed, {
        result: run.result,
        note: summary ?? `${items.length} предложений ждут проверки`,
      });
      await this.storage.delete(file).catch(() => undefined);
      await this.notifier.send(
        `🔍 Анализ завершён: ${summary ?? `${items.length} предложений ждут проверки в Improve → Анализ`}`,
      );
    } catch (error) {
      await this.publisher.finish(run, ImproveRunStatus.Failed, {
        error: message(error),
      });
      await this.notifier.send(
        `🔴 Анализ не удался: ${message(error).slice(0, 200)}`,
      );
    }
  }

  // Starts a run for each filed proposal that has not been started yet. One
  // failing start (an issue already running, say) must not stop the others.
  private async startFiled(
    run: ImproveRun,
    only?: number[],
    model = run.model,
  ): Promise<string> {
    const stored = JSON.parse(run.result ?? '{}') as AnalysisResult;
    let started = 0;
    const failed: string[] = [];

    const todo = stored.items.filter(
      (item, index) =>
        (!only || only.includes(index)) && item.issueNumber && !item.started,
    );
    const outcomes = await this.startEach(
      run.userId,
      todo.map((item) => item.issueNumber as number),
      model,
    );

    todo.forEach((item, i) => {
      const outcome = outcomes[i];

      if (outcome.ok) {
        item.started = true;
        started += 1;
      } else {
        failed.push(`#${item.issueNumber}: ${outcome.error}`);
      }
    });

    run.result = JSON.stringify(stored);
    await this.runs.save(run);

    return `в работу: ${started}${failed.length ? `, не запущено: ${failed.join('; ')}` : ''}`;
  }

  // File the chosen proposals of a reviewed analysis and take them into work.
  async startItems(
    id: number,
    model: string,
    indices?: number[],
  ): Promise<ImproveRun> {
    this.requireConfigured();
    this.requireModel(model);

    const run = await this.runs.findOne({ where: { id, kind: 'analysis' } });

    if (!run) throw new NotFoundException('Analysis run not found');
    if (run.status !== ImproveRunStatus.Analyzed) {
      throw new ConflictException('Анализ ещё не завершён');
    }

    const filed = await this.issueFiling.fileProposals(run, indices);

    // Use the model the user picked now, not the one the analysis ran with.
    run.note = `${filed}; ${await this.startFiled(run, indices, model)}`;

    return this.runs.save(run);
  }

  // Starts runs a few at a time; one failing start never stops the others. Outcomes keep input order.
  private startEach(
    userId: number,
    numbers: number[],
    model: string,
  ): Promise<
    (
      | { ok: true; number: number }
      | { ok: false; number: number; error: string }
    )[]
  > {
    return mapInBatches(numbers, START_CONCURRENCY, async (number) => {
      try {
        await this.startRun(userId, number, model);

        return { ok: true as const, number };
      } catch (error) {
        return { ok: false as const, number, error: message(error) };
      }
    });
  }

  // Several issues into work at once; each is independent.
  async startMany(
    userId: number,
    issueNumbers: number[],
    model: string,
  ): Promise<{ started: number[]; skipped: string[] }> {
    this.requireConfigured();
    this.requireModel(model);

    const outcomes = await this.startEach(userId, issueNumbers, model);
    const started: number[] = [];
    const skipped: string[] = [];

    for (const outcome of outcomes) {
      if (outcome.ok) started.push(outcome.number);
      else skipped.push(`#${outcome.number}: ${outcome.error}`);
    }

    return { started, skipped };
  }

  // ---------------------------------------------------------------- helpers

  requireConfigured(): void {
    if (!this.github.isReady()) {
      throw new BadRequestException(
        'GitHub не настроен: задайте GITHUB_REPO и LOOP_GITHUB_TOKEN на bridge',
      );
    }
  }

  requireModel(model: string): void {
    requireImproveModel(model);
  }

  private log(
    level: 'info' | 'warn' | 'error',
    event: string,
    text: string,
    meta: Record<string, unknown>,
  ): void {
    void this.appLogs.record({
      level,
      source: 'loop',
      event,
      message: text,
      meta,
    });
  }
}

const START_CONCURRENCY = 3;

export { message, PR_LABEL };
