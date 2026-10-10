import { readFile } from 'fs/promises';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';

import { AppLogService } from '../logs/app-log.service';
import { GithubApiService, TreeEntry } from '../loop/github-api.service';
import { findProtected } from '../loop/protected-paths';
import { StoredFileDirection } from '../storage/entities/stored-file.entity';
import { StorageService } from '../storage/storage.service';
import { NotifyService } from '../telegram/notify.service';
import { isValidTimeZone } from '../telegram/notification-settings.service';
import { localMinutes } from '../telegram/quiet-hours';
import { JobModel, JobStatus } from '../worker/entities/job.entity';
import { WorkerService } from '../worker/worker.service';
import {
  ACTIVE_RUN_STATUSES,
  ImproveRun,
  ImproveRunStatus,
  ImproveTrigger,
} from './entities/improve-run.entity';
import {
  ALL_CATEGORIES,
  AnalysisCategory,
  BACKLOG_FILE,
  BacklogItem,
  buildAnalysisPrompt,
  buildLogDigest,
  categoryLabel,
  isCategory,
  issueBody,
  normalizeTitle,
  parseBacklog,
  pickOnePerCategory,
} from './analysis';
import { withDefinitionOfDone } from './definition-of-done';
import { ImproveSchedule } from './entities/improve-schedule.entity';
import { ImproveSettings } from './entities/improve-settings.entity';
import {
  buildIssueParcel,
  Change,
  describeChanges,
  diffResult,
  MAX_CHANGED_BYTES,
  MAX_CHANGED_FILES,
  readResultParcel,
  readZipball,
  selectParcelFiles,
  utf8Text,
} from './parcel';

interface AnalysisResult {
  categories: AnalysisCategory[];
  autoCreate: boolean;
  autoStart?: boolean;
  items: Array<
    BacklogItem & {
      issueNumber?: number;
      duplicateOf?: number;
      started?: boolean;
    }
  >;
}

export const IMPROVE_MODELS = ['sonnet', 'opus', 'gpt', 'deepseek', 'qwen'];
const LOG_DIGEST_DAYS = 7;
const ADVANCE_EVERY_MS = 15_000;
const SCHEDULE_TICK_MS = 60_000;
const AUTOSTART_MIN_AGE_SECONDS = 10;
const PR_LABEL = 'loop';

// The loop run on bridge itself: pick a GitHub issue, hand the repository snapshot
// and the issue to a worker, and turn what comes back into a branch and a pull
// request — no reports, no developer machine. Merging stays where it always was
// (the loop's CI → Telegram → Merge flow); this only ever opens PRs.
@Injectable()
export class ImproveService {
  private readonly logger = new Logger(ImproveService.name);
  private advancing = false;
  private ticking = false;
  private autoStarting = false;

  constructor(
    @InjectRepository(ImproveRun)
    private readonly runs: Repository<ImproveRun>,
    @InjectRepository(ImproveSchedule)
    private readonly schedules: Repository<ImproveSchedule>,
    @InjectRepository(ImproveSettings)
    private readonly settings: Repository<ImproveSettings>,
    private readonly github: GithubApiService,
    private readonly storage: StorageService,
    private readonly workers: WorkerService,
    private readonly notifier: NotifyService,
    private readonly dataSource: DataSource,
    private readonly appLogs: AppLogService,
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
    const runs = issues.length
      ? await this.runs.find({
          where: {
            kind: 'issue',
            issueNumber: In(issues.map((issue) => issue.number)),
          },
          order: { id: 'DESC' },
        })
      : [];

    return issues.map((issue) => ({
      ...issue,
      run: runs.find((run) => run.issueNumber === issue.number) ?? null,
    }));
  }

  listRuns(limit = 50): Promise<ImproveRun[]> {
    return this.runs.find({
      order: { id: 'DESC' },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }

  // ------------------------------------------------------------- start a run

  async startRun(
    userId: number,
    issueNumber: number,
    model: string,
    trigger: ImproveTrigger = 'manual',
    scheduleId: number | null = null,
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

    const issue = await this.github.getIssue(issueNumber);

    if (issue.isPull || issue.state !== 'open') {
      throw new BadRequestException(`#${issueNumber} — не открытая задача`);
    }

    const { job, baseSha, baseline, fileCount } = await this.handToWorker(
      userId,
      model,
      {
        number: issue.number,
        title: issue.title,
        body: withDefinitionOfDone(issue.body),
      },
      `improve:${issue.number}`,
      `improve-${issue.number}.subscription.zip`,
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

  // Snapshot of the base branch → parcel with this task as its manifest → Storage →
  // Worker job. Shared by issue runs and analysis runs (an analysis is a task whose
  // description is the prompt).
  private async handToWorker(
    userId: number,
    model: string,
    task: { number: number | string; title: string; body: string },
    taskKey: string,
    fileName: string,
  ) {
    const baseBranch = this.github.baseBranch();
    const baseSha = await this.github.getBranchSha(baseBranch);
    const files = selectParcelFiles(
      readZipball(await this.github.downloadZipball(baseSha)),
    );
    const { buffer, baseline } = buildIssueParcel(files, {
      number: task.number,
      title: task.title,
      body: task.body,
      repo: this.github.repoName() as string,
      baseBranch,
    });
    const stored = await this.storage.createFromBuffer(
      userId,
      buffer,
      fileName,
      {
        channel: 'issue',
        taskKey,
        direction: StoredFileDirection.Outbound,
      },
    );
    const job = await this.workers.create(userId, {
      sourceFileId: stored.id,
      model: model as JobModel,
    });

    return { job, baseSha, baseline, fileCount: files.length };
  }

  async cancelRun(id: number, userId: number): Promise<ImproveRun> {
    const run = await this.runs.findOne({ where: { id } });

    if (!run) throw new NotFoundException('Run not found');
    if (!ACTIVE_RUN_STATUSES.includes(run.status)) return run;

    if (run.jobId && run.status !== ImproveRunStatus.Publishing) {
      await this.workers.cancel(run.jobId, run.userId ?? userId);
    }

    run.status = ImproveRunStatus.Cancelled;
    run.finishedAt = new Date();

    return this.runs.save(run);
  }

  // ------------------------------------------------- follow the jobs, publish

  @Interval(ADVANCE_EVERY_MS)
  async advance(): Promise<void> {
    if (this.advancing) return;

    this.advancing = true;

    try {
      const active = await this.runs.find({
        where: {
          status: In([ImproveRunStatus.Queued, ImproveRunStatus.Running]),
        },
        order: { id: 'ASC' },
      });

      for (const run of active) {
        await this.advanceOne(run).catch((error) =>
          this.logger.warn(
            `Run ${run.id} could not be advanced: ${message(error)}`,
          ),
        );
      }
    } finally {
      this.advancing = false;
    }
  }

  async advanceOne(run: ImproveRun): Promise<void> {
    if (!run.jobId) return;

    const job = await this.workers.findOwned(run.jobId, run.userId);

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
        else await this.publish(run, job.resultFileId);
      }

      return;
    }

    if (job.status === JobStatus.Failed) {
      await this.finish(run, ImproveRunStatus.Failed, {
        error: job.errorMessage ?? 'Задача worker завершилась ошибкой',
      });
    } else if (job.status === JobStatus.Cancelled) {
      await this.finish(run, ImproveRunStatus.Cancelled, {
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

  // result parcel → diff against the baseline → branch → PR.
  async publish(run: ImproveRun, resultFileId: number | null): Promise<void> {
    try {
      if (!resultFileId) throw new Error('У задачи worker нет результата');

      const file = await this.storage.findOwned(resultFileId, run.userId);
      const result = readResultParcel(await readFile(this.storage.path(file)));
      const changes = diffResult(
        JSON.parse(run.baseline ?? '{}') as Record<string, string>,
        result,
      );

      // The enforced boundary: the loop never proposes a change to its own machinery
      // or to CI/deploy — those are dropped here, not merely discouraged in a prompt.
      const blocked = new Set(
        findProtected(changes.map((change) => change.path)),
      );
      const allowed = changes.filter((change) => !blocked.has(change.path));
      const note = blocked.size
        ? `Отброшены изменения защищённых путей: ${[...blocked].join(', ')}`
        : null;

      if (allowed.length === 0) {
        await this.finish(run, ImproveRunStatus.NoChanges, {
          note: note ?? 'Worker ничего не изменил',
        });
        await this.notifier.send(
          `ℹ️ Задача #${run.issueNumber}: worker не внёс изменений — PR не нужен`,
        );

        return;
      }

      if (allowed.length > MAX_CHANGED_FILES) {
        throw new Error(
          `Слишком много изменённых файлов (${allowed.length} > ${MAX_CHANGED_FILES})`,
        );
      }

      const size = allowed.reduce(
        (sum, change) => sum + (change.bytes?.length ?? 0),
        0,
      );

      if (size > MAX_CHANGED_BYTES) {
        throw new Error(
          `Слишком большой результат (${Math.round(size / 1024)} КБ)`,
        );
      }

      const pr = await this.openPullRequest(run, allowed, note);

      await this.finish(run, ImproveRunStatus.PrOpen, {
        branch: pr.branch,
        prNumber: pr.number,
        prUrl: pr.url,
        note: [describeChanges(allowed), note].filter(Boolean).join('. '),
      });
      await this.storage.delete(file).catch(() => undefined);
      await this.notifier.send(
        `🔀 Задача #${run.issueNumber} → PR #${pr.number} (${describeChanges(allowed)})\n${pr.url}`,
      );
    } catch (error) {
      await this.finish(run, ImproveRunStatus.Failed, {
        error: message(error),
      });
      await this.notifier.send(
        `🔴 Задача #${run.issueNumber}: не удалось открыть PR — ${message(error).slice(0, 200)}`,
      );
    }
  }

  private async openPullRequest(
    run: ImproveRun,
    changes: Change[],
    note: string | null,
  ) {
    const baseSha = run.baseSha as string;
    const baseTree = await this.github.getCommitTreeSha(baseSha);
    const tree: TreeEntry[] = [];

    for (const change of changes) {
      tree.push({
        path: change.path,
        mode: '100644',
        type: 'blob',
        sha:
          change.kind === 'deleted'
            ? null
            : await this.github.createBlob(change.bytes as Uint8Array),
      });
    }

    const commit = await this.github.createCommit(
      `Pull issue #${run.issueNumber}: ${run.issueTitle}\n\nAutomated by bridge Improve (run ${run.id}, ${run.model}).`,
      await this.github.createTree(baseTree, tree),
      baseSha,
    );
    const branch = `improve/issue-${run.issueNumber}-run-${run.id}`;

    await this.github.createBranch(branch, commit);

    const pull = await this.github.createPull({
      title: run.issueTitle,
      head: branch,
      base: this.github.baseBranch(),
      body: [
        `Closes #${run.issueNumber}`,
        '',
        `Automated by bridge Improve (run ${run.id}, model ${run.model}, trigger ${run.trigger}): ${describeChanges(changes)}.`,
        ...(note ? ['', `⚠️ ${note}`] : []),
        '',
        'Не влито автоматически — проверьте и влейте как обычно (CI → Telegram → Merge).',
      ].join('\n'),
    });

    // The loop picks the PR up by this label (see LoopService's adoption).
    await this.github
      .addLabels(pull.number, [PR_LABEL])
      .catch((error) =>
        this.logger.warn(
          `Could not label PR #${pull.number}: ${message(error)}`,
        ),
      );

    return { branch, number: pull.number, url: pull.htmlUrl };
  }

  private async finish(
    run: ImproveRun,
    status: ImproveRunStatus,
    patch: Partial<
      Pick<
        ImproveRun,
        'error' | 'note' | 'branch' | 'prNumber' | 'prUrl' | 'result'
      >
    >,
  ): Promise<void> {
    Object.assign(run, patch, { status, finishedAt: new Date() });
    await this.runs.save(run);
    this.log(
      status === ImproveRunStatus.Failed ? 'error' : 'info',
      `improve.${status}`,
      `Run ${run.id} (issue #${run.issueNumber}): ${status}${patch.error ? ` — ${patch.error}` : ''}`,
      {
        runId: run.id,
        jobId: run.jobId ?? undefined,
        prNumber: patch.prNumber ?? undefined,
      },
    );
  }

  // -------------------------------------------------------------- analysis

  // A worker reads the repository and proposes one improvement per direction. The
  // proposals are filed as GitHub issues (labelled `loop`) right away when
  // `autoCreate`, otherwise kept on the run for review.
  async startAnalysis(
    userId: number,
    model: string,
    categories: AnalysisCategory[] = ALL_CATEGORIES,
    autoCreate = false,
    trigger: ImproveTrigger = 'manual',
    scheduleId: number | null = null,
    autoStart = false,
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

    const titles = (await this.github.listIssueTitles()).map(
      (issue) => issue.title,
    );
    const date = new Date().toISOString().slice(0, 10);
    const { job, baseSha, fileCount } = await this.handToWorker(
      userId,
      model,
      {
        number: `analysis-${date}`,
        title: `Analysis ${date}`,
        body: buildAnalysisPrompt(titles, categories, await this.logDigest()),
      },
      'improve:analysis',
      `improve-analysis-${date}.subscription.zip`,
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
        this.appLogs.list({ days: LOG_DIGEST_DAYS, limit: 300 }),
      ]);

      return buildLogDigest(
        summary,
        recent.filter((row) => row.level !== 'info'),
      );
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
      const result = readResultParcel(await readFile(this.storage.path(file)));
      const raw = result.get(BACKLOG_FILE);

      if (!raw) throw new Error(`Worker не создал ${BACKLOG_FILE}`);

      const stored = JSON.parse(run.result ?? '{}') as AnalysisResult;
      const items = pickOnePerCategory(
        parseBacklog(utf8Text(raw)),
        stored.categories ?? ALL_CATEGORIES,
      );

      if (items.length === 0) {
        await this.finish(run, ImproveRunStatus.Analyzed, {
          result: JSON.stringify({ ...stored, items: [] }),
          note: 'Анализ ничего не предложил',
        });
        await this.notifier.send('ℹ️ Анализ завершён: предложений нет');
        await this.storage.delete(file).catch(() => undefined);

        return;
      }

      run.result = JSON.stringify({ ...stored, items });

      let summary = stored.autoCreate
        ? await this.createIssuesFromRun(run)
        : null;

      if (summary && stored.autoStart) {
        summary += `; ${await this.startFiled(run)}`;
      }

      await this.finish(run, ImproveRunStatus.Analyzed, {
        result: run.result,
        note: summary ?? `${items.length} предложений ждут проверки`,
      });
      await this.storage.delete(file).catch(() => undefined);
      await this.notifier.send(
        `🔍 Анализ завершён: ${summary ?? `${items.length} предложений ждут проверки в Improve → Анализ`}`,
      );
    } catch (error) {
      await this.finish(run, ImproveRunStatus.Failed, {
        error: message(error),
      });
      await this.notifier.send(
        `🔴 Анализ не удался: ${message(error).slice(0, 200)}`,
      );
    }
  }

  // Files the run's proposals as issues, skipping any whose title matches an existing
  // issue. Records each item's outcome on the run and returns a one-line summary.
  async createIssuesFromRun(run: ImproveRun, only?: number[]): Promise<string> {
    const stored = JSON.parse(run.result ?? '{}') as AnalysisResult;
    const existing = new Map(
      (await this.github.listIssueTitles()).map((issue) => [
        normalizeTitle(issue.title),
        issue.number,
      ]),
    );
    let created = 0;
    let duplicates = 0;
    const unlabelled: number[] = [];

    for (const [index, item] of stored.items.entries()) {
      if (only && !only.includes(index)) continue;
      if (item.issueNumber || item.duplicateOf) continue;

      const duplicate = existing.get(normalizeTitle(item.title));

      if (duplicate) {
        item.duplicateOf = duplicate;
        duplicates += 1;
        continue;
      }

      const issue = await this.github.createIssue({
        title: item.title,
        body: issueBody(item),
        labels: [PR_LABEL, `risk:${item.risk}`, `category:${item.category}`],
      });

      item.issueNumber = issue.number;
      existing.set(normalizeTitle(item.title), issue.number);
      created += 1;

      if ((issue.missingLabels ?? []).includes(PR_LABEL)) {
        unlabelled.push(issue.number);
      }
    }

    if (unlabelled.length > 0) {
      this.log(
        'warn',
        'improve.labels_missing',
        `Issues ${unlabelled.map((n) => `#${n}`).join(', ')} were created without the "${PR_LABEL}" label`,
        { runId: run.id },
      );
    }

    run.result = JSON.stringify(stored);
    await this.runs.save(run);

    return `создано задач: ${created}${duplicates ? `, дубликатов пропущено: ${duplicates}` : ''}${unlabelled.length ? `; ⚠ без метки ${PR_LABEL}: ${unlabelled.map((n) => `#${n}`).join(', ')} — проверьте права токена (Issues: write)` : ''}`;
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

    for (const [index, item] of stored.items.entries()) {
      if (only && !only.includes(index)) continue;
      if (!item.issueNumber || item.started) continue;

      try {
        await this.startRun(run.userId, item.issueNumber, model);
        item.started = true;
        started += 1;
      } catch (error) {
        failed.push(`#${item.issueNumber}: ${message(error)}`);
      }
    }

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

    const filed = await this.createIssuesFromRun(run, indices);

    // Use the model the user picked now, not the one the analysis ran with.
    run.note = `${filed}; ${await this.startFiled(run, indices, model)}`;

    return this.runs.save(run);
  }

  // Several issues into work at once; each is independent.
  async startMany(
    userId: number,
    issueNumbers: number[],
    model: string,
  ): Promise<{ started: number[]; skipped: string[] }> {
    this.requireConfigured();
    this.requireModel(model);

    const started: number[] = [];
    const skipped: string[] = [];

    for (const number of issueNumbers) {
      try {
        await this.startRun(userId, number, model);
        started.push(number);
      } catch (error) {
        skipped.push(`#${number}: ${message(error)}`);
      }
    }

    return { started, skipped };
  }

  // The manual path for a reviewed analysis: file the chosen proposals.
  async createIssues(id: number, indices?: number[]): Promise<ImproveRun> {
    this.requireConfigured();

    const run = await this.runs.findOne({ where: { id, kind: 'analysis' } });

    if (!run) throw new NotFoundException('Analysis run not found');
    if (run.status !== ImproveRunStatus.Analyzed) {
      throw new ConflictException('Анализ ещё не завершён');
    }

    run.note = await this.createIssuesFromRun(run, indices);

    return this.runs.save(run);
  }

  // ------------------------------------------------------------- schedules

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
    },
    id?: number,
  ): Promise<ImproveSchedule> {
    this.requireModel(input.model);

    if (!isValidTimeZone(input.timezone)) {
      throw new BadRequestException(
        `Неизвестный часовой пояс: ${input.timezone}`,
      );
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
        if (!isDue(schedule, now)) continue;

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

    this.requireConfigured();

    if (schedule.kind === 'analysis') {
      const categories = schedule.categories
        ? (schedule.categories
            .split(',')
            .filter(isCategory) as AnalysisCategory[])
        : ALL_CATEGORIES;
      let summary: string;

      try {
        const run = await this.startAnalysis(
          schedule.userId,
          schedule.model,
          categories,
          schedule.autoCreateIssues || schedule.autoStartIssues,
          'schedule',
          schedule.id,
          schedule.autoStartIssues,
        );

        started.push(run.id);
        summary = 'анализ запущен';
      } catch (error) {
        skipped.push(message(error));
        summary = `анализ не запущен: ${message(error)}`;
      }

      await this.schedules.update(schedule.id, {
        lastRunAt: new Date(),
        lastResult: summary,
      });
      await this.notifier.send(`🌙 Расписание «${schedule.name}»: ${summary}`);

      return { started, skipped };
    }

    for (const issue of await this.github.listOpenIssues(schedule.label, 100)) {
      if (started.length >= schedule.count) break;

      try {
        await this.startRun(
          schedule.userId,
          issue.number,
          schedule.model,
          'schedule',
          schedule.id,
        );
        started.push(issue.number);
      } catch (error) {
        skipped.push(`#${issue.number}: ${message(error)}`);
      }
    }

    const summary = `${started.length} запущено${skipped.length ? `, ${skipped.length} пропущено` : ''}`;

    await this.schedules.update(schedule.id, {
      lastRunAt: new Date(),
      lastResult: summary,
    });
    await this.notifier.send(
      `🌙 Расписание «${schedule.name}»: ${summary}${started.length ? ` (${started.map((n) => `#${n}`).join(', ')})` : ''}`,
    );

    return { started, skipped };
  }

  // ----------------------------------------- reports pushes → worker at once

  async getSettings(userId: number): Promise<ImproveSettings | null> {
    return this.settings.findOne({ where: { userId } });
  }

  async saveSettings(
    userId: number,
    autoStartModel: string | null,
  ): Promise<ImproveSettings> {
    if (autoStartModel) this.requireModel(autoStartModel);

    const existing = await this.getSettings(userId);
    const enabling = autoStartModel && !existing?.autoStartModel;

    return this.settings.save({
      userId,
      autoStartModel,
      autoStartSince: autoStartModel
        ? enabling
          ? new Date()
          : (existing?.autoStartSince ?? new Date())
        : null,
    });
  }

  // A parcel pushed from Subscription (channel "issue", outbound, unencrypted) that no
  // job has picked up yet, for an account that switched auto-start on, starts a job.
  @Interval(ADVANCE_EVERY_MS)
  async autoStartParcels(): Promise<void> {
    if (this.autoStarting) return;

    this.autoStarting = true;

    try {
      const accounts = await this.settings.find({
        where: { autoStartModel: Not(IsNull()) },
      });
      const rows: Array<{ fileId: number; userId: number; model: string }> =
        [];

      for (const account of accounts) {
        if (!account.autoStartModel || !account.autoStartSince) continue;

        const parcels = await this.workers.findUnstartedIssueParcels(
          account.userId,
          account.autoStartSince,
          AUTOSTART_MIN_AGE_SECONDS,
          'improve:',
        );
        for (const parcel of parcels) {
          rows.push({
            fileId: parcel.id,
            userId: account.userId,
            model: account.autoStartModel,
          });
        }
      }

      for (const row of rows) {
        await this.workers
          .create(row.userId, {
            sourceFileId: row.fileId,
            model: row.model as JobModel,
          })
          .then((job) =>
            this.log(
              'info',
              'improve.auto_started',
              `Parcel ${row.fileId} → job ${job.id} (${row.model})`,
              { fileId: row.fileId, jobId: job.id },
            ),
          )
          .catch((error) =>
            this.logger.warn(
              `Auto-start of parcel ${row.fileId} failed: ${message(error)}`,
            ),
          );
      }
    } finally {
      this.autoStarting = false;
    }
  }

  // ---------------------------------------------------------------- helpers

  private requireConfigured(): void {
    if (!this.github.isReady()) {
      throw new BadRequestException(
        'GitHub не настроен: задайте GITHUB_REPO и LOOP_GITHUB_TOKEN на bridge',
      );
    }
  }

  private requireModel(model: string): void {
    if (!IMPROVE_MODELS.includes(model)) {
      throw new BadRequestException(`Неизвестная модель: ${model}`);
    }
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

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// "YYYY-MM-DD" of `now` in the schedule's own time zone.
export function localDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

// Due once today's HH:MM has passed in its time zone and it has not fired today —
// ">=" rather than "==" so a bridge that was down at 02:00 still runs it when it is
// back, once.
export function isDue(
  schedule: Pick<ImproveSchedule, 'hour' | 'minute' | 'timezone' | 'lastRunOn'>,
  now: Date,
): boolean {
  return (
    localDate(now, schedule.timezone) !== schedule.lastRunOn &&
    localMinutes(now, schedule.timezone) >= schedule.hour * 60 + schedule.minute
  );
}
