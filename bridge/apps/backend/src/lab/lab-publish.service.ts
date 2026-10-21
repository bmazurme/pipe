import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { buildResultTree } from '../improve/improve-shared';
import { describeChanges, diffResult } from '../improve/parcel';
import { StorageService } from '../storage/storage.service';
import { NotifyService } from '../telegram/notify.service';
import { LabRun, LabRunStatus } from './entities/lab-run.entity';
import { describeGithubError, githubFor } from './lab-github';
import { LabProjectsService } from './lab-projects.service';
import {
  LAB_MAX_CHANGED_BYTES,
  LAB_MAX_CHANGED_FILES,
  readLabResult,
  splitBaseline,
  withBinaries,
} from './lab-result';

// Lab never touches CI/deploy definitions or git internals of somebody else's repository.
const BLOCKED = [/^\.github\/workflows\//, /^\.git\//];

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

// Turns a finished worker job into a branch and a pull request, and records how a run ended.
// Depends only on GitHub, the run table, the store and the notifier.
@Injectable()
export class LabPublishService {
  constructor(
    @InjectRepository(LabRun)
    private readonly runs: Repository<LabRun>,
    private readonly projects: LabProjectsService,
    private readonly storage: StorageService,
    private readonly notifier: NotifyService,
  ) {}

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
      const followUp = Boolean(run.prNumber && run.branch);
      const commit = await github.createCommit(
        `${followUp ? `Update PR #${run.prNumber}: ` : ''}${run.title}\n\nAutomated by bridge Lab (run ${run.id}, ${run.model}).`,
        await buildResultTree(github, baseSha, allowed),
        baseSha,
      );

      if (followUp) {
        // Never forced: a PR branch that moved since the snapshot fails the run.
        await github.updateBranch(run.branch as string, commit);
        await this.finish(run, LabRunStatus.PrOpen, {
          note: [describeChanges(allowed), note].filter(Boolean).join('. '),
        });
        await this.storage.delete(file).catch(() => undefined);
        await this.notifier.send(
          `🔀 Lab «${run.title}» → новый коммит в PR #${run.prNumber} в ${run.repo} (${describeChanges(allowed)})\n${run.prUrl}`,
        );

        return;
      }
      const branch = `lab/run-${run.id}-${slug(run.title)}`;

      await github.createBranch(branch, commit);

      let pull: { number: number; htmlUrl: string };

      try {
        pull = await github.createPull({
          title: run.title,
          head: branch,
          // Runs from before the per-run branch have none: they target the project's.
          base: run.baseBranch ?? project.baseBranch,
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
}
