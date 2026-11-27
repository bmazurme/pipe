import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AppLogService } from '../logs/app-log.service';
import { GithubApiService } from '../loop/github-api.service';
import { findProtected } from '../loop/protected-paths';
import { StorageService } from '../storage/storage.service';
import { NotifyService } from '../telegram/notify.service';
import { withDefinitionOfDone } from './definition-of-done';
import { ImproveRun, ImproveRunStatus } from './entities/improve-run.entity';
import { ImproveHandoffService } from './improve-handoff.service';
import { buildResultTree, message, PR_LABEL } from './improve-shared';
import {
  applyChanges,
  Change,
  describeChanges,
  diffResult,
  MAX_CHANGED_BYTES,
  MAX_CHANGED_FILES,
  readResultParcel,
  readResultVerification,
} from './parcel';
import {
  describeForPr,
  gateDecision,
  parseVerification,
  retryTask,
  type Verification,
} from './verification';

// GitHub answers a fine-grained token that lacks a permission with this one line, which says nothing
// about WHICH permission — name them, so the owner does not have to guess (it cost three failed runs once).
const TOKEN_PERMISSION_ERROR =
  'Resource not accessible by personal access token';

export function describePublishError(error: unknown): string {
  const text = message(error);

  return text.includes(TOKEN_PERMISSION_ERROR)
    ? `${text}. Токену GitHub (LOOP_GITHUB_TOKEN) не хватает права: для Improve нужны Issues, Pull requests и Contents — чтение и запись, Checks — чтение`
    : text;
}

// Turns a finished worker job into a branch and a pull request (or a commit on a PR's branch), and
// records how a run ended. Depends only on GitHub, the run table, the store and the notifier.
@Injectable()
export class ImprovePublishService {
  private readonly logger = new Logger(ImprovePublishService.name);

  constructor(
    @InjectRepository(ImproveRun)
    private readonly runs: Repository<ImproveRun>,
    private readonly github: GithubApiService,
    private readonly storage: StorageService,
    private readonly notifier: NotifyService,
    private readonly appLogs: AppLogService,
    private readonly handoff: ImproveHandoffService,
  ) {}

  // result parcel → diff against the baseline → branch → PR.
  // `skipGate`: the owner chose to publish a result whose check failed (the button on a failed run).
  async publish(
    run: ImproveRun,
    resultFileId: number | null,
    options: { skipGate?: boolean } = {},
  ): Promise<void> {
    try {
      if (!resultFileId) throw new Error('У задачи worker нет результата');

      // `baseline` is not selected by default; fetch it when the run came without.
      if (run.baseline === undefined) {
        const stored = await this.runs.findOne({
          where: { id: run.id },
          select: { id: true, baseline: true },
        });

        run.baseline = stored?.baseline ?? null;
      }
      const file = await this.storage.findOwned(resultFileId, run.userId);
      const resultBytes = await this.storage.readBytes(file);
      const result = await readResultParcel(resultBytes);

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
          run.kind === 'repair'
            ? `ℹ️ PR #${run.prNumber}: автоисправление CI не внесло изменений`
            : `ℹ️ Задача #${run.issueNumber}: worker не внёс изменений — PR не нужен`,
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

      // A3: the worker checked its own result before sending it. A red check is not turned into a pull request until the worker has had one more
      // go at it; CI after the PR stays the judge (and the fallback) either way. Only a new pull request is gated — a repair is a commit on one.
      let verification: Verification | null = null;
      let gateNote: string | null = null;

      if (run.kind === 'issue') {
        const raw = await readResultVerification(resultBytes).catch(() => null);

        verification = raw ? parseVerification(raw) : null;

        const decision = gateDecision(verification, run.gateRetries ?? 0, {
          skipGate: options.skipGate,
        });

        if (decision.action === 'retry') {
          if (
            await this.retryAfterGate(
              run,
              allowed,
              verification as Verification,
            )
          ) {
            await this.storage.delete(file).catch(() => undefined);

            return;
          }

          // The second go could not be started: the work is not thrown away, the pull request is opened and CI tells the rest.
          gateNote =
            'Проверка перед PR не прошла, а повторный запуск worker не удалось начать';
        } else if (decision.action === 'fail') {
          await this.finish(run, ImproveRunStatus.Failed, {
            error: `${decision.reason}. Результат сохранён: «Повторить публикацию» откроет PR как есть`,
          });
          await this.notifier.send(
            `🔴 Задача #${run.issueNumber}: ${decision.reason}. PR не открыт; результат сохранён — «Повторить публикацию» откроет его как есть`,
          );

          return;
        }
      }

      if (run.kind === 'repair') {
        await this.commitRepair(run, allowed);
        await this.finish(run, ImproveRunStatus.PrUpdated, {
          note: [run.note, describeChanges(allowed), note]
            .filter(Boolean)
            .join('. '),
        });
        await this.storage.delete(file).catch(() => undefined);
        await this.notifier.send(
          `🔧 PR #${run.prNumber}: автоисправление CI (${describeChanges(allowed)}) — жду новый прогон\n${run.prUrl ?? ''}`.trim(),
        );

        return;
      }

      const pr = await this.openPullRequest(
        run,
        allowed,
        [note, gateNote].filter(Boolean).join('. ') || null,
        describeForPr(verification, (run.gateRetries ?? 0) > 0),
      );

      await this.finish(run, ImproveRunStatus.PrOpen, {
        branch: pr.branch,
        prNumber: pr.number,
        prUrl: pr.url,
        note: [describeChanges(allowed), note, gateNote]
          .filter(Boolean)
          .join('. '),
      });
      await this.storage.delete(file).catch(() => undefined);
      await this.notifier.send(
        `🔀 Задача #${run.issueNumber} → PR #${pr.number} (${describeChanges(allowed)})\n${pr.url}`,
      );
    } catch (error) {
      const reason = describePublishError(error);

      await this.finish(run, ImproveRunStatus.Failed, { error: reason });
      await this.notifier.send(
        run.kind === 'repair'
          ? `🔴 PR #${run.prNumber}: автоисправление CI не удалось — ${reason.slice(0, 200)}`
          : `🔴 Задача #${run.issueNumber}: не удалось открыть PR — ${reason.slice(0, 200)}`,
      );
    }
  }

  // The blobs and the tree of a result on top of a commit — shared by the first PR and by a repair.
  private createTreeFor(baseSha: string, changes: Change[]): Promise<string> {
    return buildResultTree(this.github, baseSha, changes);
  }

  // A repair is a commit on top of the PR's head, pushed to the PR's own branch (never forced).
  private async commitRepair(run: ImproveRun, changes: Change[]) {
    const headSha = run.baseSha as string;
    const commit = await this.github.createCommit(
      `${run.trigger === 'chat' ? 'Update' : 'Fix CI on'} PR #${run.prNumber}\n\nAutomated by bridge Improve (run ${run.id}, ${run.model}): ${describeChanges(changes)}.`,
      await this.createTreeFor(headSha, changes),
      headSha,
    );

    await this.github.updateBranch(run.branch as string, commit);
  }

  // A second go at the task before any pull request exists: the snapshot the run started from WITH the worker's changes on it, and the check's
  // output in the task. The baseline stays the original one, so the final diff is still the whole change. The same run moves on to the new job
  // (one row, one PR). Returns false when it could not be started; never throws.
  private async retryAfterGate(
    run: ImproveRun,
    changes: Change[],
    verification: Verification,
  ): Promise<boolean> {
    try {
      const baseSha = run.baseSha as string;
      const { files } = await this.handoff.snapshotAt(baseSha);
      const issue = await this.github.getIssue(run.issueNumber as number);
      const { job } = await this.handoff.handToWorker(
        run.userId,
        run.model,
        {
          number: run.issueNumber as number,
          title: run.issueTitle,
          body: retryTask(withDefinitionOfDone(issue.body), verification),
        },
        `improve:${run.issueNumber}`,
        `improve-${run.issueNumber}.subscription.zip`,
        undefined,
        {
          baseSha,
          files: applyChanges(files, changes),
          baseline: JSON.parse(run.baseline ?? '{}') as Record<string, string>,
        },
      );
      const moved = await this.runs.update(
        { id: run.id, status: ImproveRunStatus.Publishing },
        {
          status: ImproveRunStatus.Queued,
          jobId: job.id,
          error: null,
          finishedAt: null,
          gateRetries: (run.gateRetries ?? 0) + 1,
          note: 'Проверка перед PR не прошла — worker исправляет результат (вторая попытка)',
        },
      );

      if (moved.affected !== 1) return false;

      Object.assign(run, {
        status: ImproveRunStatus.Queued,
        jobId: job.id,
        gateRetries: (run.gateRetries ?? 0) + 1,
      });
      this.log(
        'info',
        'improve.gate_retry',
        `Run ${run.id} (issue #${run.issueNumber}): the check failed (${verification.summary}) — second go as job ${job.id}`,
        { runId: run.id, jobId: job.id },
      );
      await this.notifier.send(
        `🔁 Задача #${run.issueNumber}: проверка перед PR не прошла — worker исправляет результат (вторая попытка)`,
      );

      return true;
    } catch (error) {
      this.logger.warn(
        `Run ${run.id}: the second go after a failed check could not be started: ${message(error)}`,
      );

      return false;
    }
  }

  private async openPullRequest(
    run: ImproveRun,
    changes: Change[],
    note: string | null,
    verificationText: string | null = null,
  ) {
    const baseSha = run.baseSha as string;
    const commit = await this.github.createCommit(
      `Pull issue #${run.issueNumber}: ${run.issueTitle}\n\nAutomated by bridge Improve (run ${run.id}, ${run.model}).`,
      await this.createTreeFor(baseSha, changes),
      baseSha,
    );
    const branch = `improve/issue-${run.issueNumber}-run-${run.id}`;

    await this.github.createBranch(branch, commit);

    let pull: { number: number; htmlUrl: string };

    try {
      pull = await this.github.createPull({
        title: run.issueTitle,
        head: branch,
        base: this.github.baseBranch(),
        body: [
          `Closes #${run.issueNumber}`,
          '',
          `Automated by bridge Improve (run ${run.id}, model ${run.model}, trigger ${run.trigger}): ${describeChanges(changes)}.`,
          ...(note ? ['', `⚠️ ${note}`] : []),
          ...(verificationText ? ['', verificationText] : []),
          '',
          'Не влито автоматически — проверьте и влейте как обычно (CI → Telegram → Merge).',
        ].join('\n'),
      });
    } catch (error) {
      // A branch with no PR helps nobody, and every retry would leave another one behind.
      await this.github
        .deleteBranch(branch)
        .catch((cleanup) =>
          this.logger.warn(
            `Could not remove branch ${branch} after a failed PR: ${message(cleanup)}`,
          ),
        );

      throw error;
    }

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

  async finish(
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
