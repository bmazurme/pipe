import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AppLogService } from '../logs/app-log.service';
import { GithubApiService } from '../loop/github-api.service';
import { findProtected } from '../loop/protected-paths';
import { StorageService } from '../storage/storage.service';
import { NotifyService } from '../telegram/notify.service';
import { ImproveRun, ImproveRunStatus } from './entities/improve-run.entity';
import { buildResultTree, message, PR_LABEL } from './improve-shared';
import {
  Change,
  describeChanges,
  diffResult,
  MAX_CHANGED_BYTES,
  MAX_CHANGED_FILES,
  readResultParcel,
} from './parcel';

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
  ) {}

  // result parcel → diff against the baseline → branch → PR.
  async publish(run: ImproveRun, resultFileId: number | null): Promise<void> {
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
      const result = await readResultParcel(await this.storage.readBytes(file));

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

  private async openPullRequest(
    run: ImproveRun,
    changes: Change[],
    note: string | null,
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
