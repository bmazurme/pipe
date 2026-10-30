import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThan, Not, Repository } from 'typeorm';

import { GithubApiService } from '../loop/github-api.service';
import { NotifyService } from '../telegram/notify.service';
import {
  ACTIVE_RUN_STATUSES,
  ImproveRun,
  ImproveRunStatus,
} from './entities/improve-run.entity';
import { ImproveSettings } from './entities/improve-settings.entity';
import { ImproveService } from './improve.service';
import {
  formatFailures,
  MAX_REPAIRS_PER_PR,
  REPAIR_MAX_PR_AGE_MS,
} from './repair';

const CI_CHECK_EVERY_MS = 180_000;
const MAX_PRS_PER_TICK = 20;

// Watches the open pull requests Improve made. When CI is red on one, hands it back to a worker with
// the failing checks (ImproveService.startRepair) — twice at most per PR, once per head commit, and only
// while the PR is open and recent. Polling, not a webhook: nothing to configure on GitHub, and it works
// from behind a home router.
@Injectable()
export class ImproveCiService {
  private readonly logger = new Logger(ImproveCiService.name);
  private checking = false;
  // PR#:sha pairs already reported as "out of attempts", so the owner hears it once.
  private readonly reportedExhausted = new Set<string>();
  // PR#:sha pairs already brought up to date with the base, or reported as conflicting: once per head commit, never in a loop.
  private readonly freshened = new Set<string>();
  // PR#:sha pairs whose failed workflow runs were already re-run once (a flaky test passes the second time; a worker is not needed).
  private readonly rerun = new Set<string>();

  constructor(
    @InjectRepository(ImproveRun)
    private readonly runs: Repository<ImproveRun>,
    @InjectRepository(ImproveSettings)
    private readonly settings: Repository<ImproveSettings>,
    private readonly github: GithubApiService,
    private readonly improve: ImproveService,
    private readonly notifier: NotifyService,
  ) {}

  @Interval(CI_CHECK_EVERY_MS)
  async tick(now = new Date()): Promise<void> {
    if (this.checking || !this.github.isReady()) return;

    this.checking = true;

    try {
      const parents = await this.runs.find({
        where: {
          kind: 'issue',
          status: ImproveRunStatus.PrOpen,
          prNumber: Not(IsNull()),
          finishedAt: MoreThan(new Date(now.getTime() - REPAIR_MAX_PR_AGE_MS)),
        },
        order: { id: 'DESC' },
        take: MAX_PRS_PER_TICK,
      });

      for (const parent of parents) {
        await this.checkOne(parent).catch((error) =>
          this.logger.warn(
            `CI check of PR #${parent.prNumber} failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    } finally {
      this.checking = false;
    }
  }

  // Returns what it did, for the tests and the log: 'repair' | a reason it skipped.
  async checkOne(parent: ImproveRun): Promise<string> {
    const prNumber = parent.prNumber as number;
    const row = await this.settings.findOne({
      where: { userId: parent.userId },
    });

    if (row && row.autoRepairCi === false) return 'disabled';

    const active = await this.runs.count({
      where: {
        kind: 'repair',
        prNumber,
        status: In(ACTIVE_RUN_STATUSES),
      },
    });

    if (active > 0) return 'repair-running';

    const pull = await this.github.getPull(prNumber);

    if (pull.state !== 'open' || pull.merged) return 'closed';

    // A conflicting PR gets no CI run of the merge result at all, so this comes before looking at CI.
    if (pull.mergeable === false) return this.onConflict(parent, pull, row);

    const ci = await this.github.ciState(pull.headSha);

    if (ci === 'success') return this.keepFresh(parent, pull);

    if (ci !== 'failure') return 'ci-ok';

    // Red once: ask GitHub to re-run the failed jobs before spending a worker. A real failure fails again and goes on to the repair below.
    const rerunKey = `${prNumber}:${pull.headSha}`;

    if (!this.rerun.has(rerunKey)) {
      this.rerun.add(rerunKey);

      const rerun = await this.github
        .rerunFailedRuns(pull.headSha)
        .catch((error) => {
          // Usually the token lacks Actions: write — then the worker repair below is all there is.
          this.logger.warn(
            `Could not re-run the failed checks of PR #${prNumber}: ${error instanceof Error ? error.message : String(error)}`,
          );

          return 0;
        });

      if (rerun > 0) {
        await this.notifier.send(
          `🔁 PR #${prNumber}: CI красный — перезапустил упавшие проверки (вдруг флейк), жду результата\n${parent.prUrl ?? ''}`.trim(),
        );

        return 'rerun';
      }
    }

    const repairs = await this.runs.find({
      where: { kind: 'repair', prNumber, trigger: 'ci' },
    });

    // The same head commit was already tried (and changed nothing, or failed): don't loop on it.
    if (repairs.some((repair) => repair.baseSha === pull.headSha)) {
      return 'already-tried';
    }

    if (repairs.length >= MAX_REPAIRS_PER_PR) {
      const key = `${prNumber}:${pull.headSha}`;

      if (!this.reportedExhausted.has(key)) {
        this.reportedExhausted.add(key);
        await this.notifier.send(
          `🔴 PR #${prNumber}: CI красный, автоисправления исчерпаны (${MAX_REPAIRS_PER_PR}) — нужен человек\n${parent.prUrl ?? ''}`.trim(),
        );
      }

      return 'exhausted';
    }

    const failed = await this.github.failedChecks(pull.headSha);

    // ciState counts a cancelled run as failing; a cancelled run is nothing to repair.
    if (failed.length === 0) return 'nothing-to-repair';

    let run: ImproveRun;

    try {
      run = await this.improve.startRepair(
        parent,
        {
          number: prNumber,
          headSha: pull.headSha,
          branch: parent.branch as string,
        },
        formatFailures(failed),
      );
    } catch (error) {
      // Another start for this PR (a chat change, say) is still handing off: its run is not saved
      // yet, so the count above missed it. Try again next tick.
      if (error instanceof ConflictException) return 'repair-running';
      throw error;
    }

    await this.notifier.send(
      `🛠 PR #${prNumber}: CI красный (${failed.map((check) => check.name).join(', ')}) — запускаю автоисправление, попытка ${repairs.length + 1} из ${MAX_REPAIRS_PER_PR} (запуск #${run.id})`,
    );

    return 'repair';
  }

  // A green PR that is behind `main` gets main merged into its branch by GitHub ("Update branch"), so what is merged is what was tested
  // against today's main, and a spec that drifted meanwhile is caught here and not at the merge button.
  private async keepFresh(
    parent: ImproveRun,
    pull: {
      number: number;
      headSha: string;
      baseRef: string;
      mergeable: boolean | null;
    },
  ): Promise<string> {
    const key = `${pull.number}:${pull.headSha}`;

    if (this.freshened.has(key)) return 'ci-ok';

    if ((await this.github.behindBy(pull.baseRef, pull.headSha)) === 0) {
      return 'ci-ok';
    }

    this.freshened.add(key);

    try {
      await this.github.updatePullBranch(pull.number, pull.headSha);
    } catch (error) {
      // 409: the head moved meanwhile; 422: the merge has conflicts GitHub had not computed yet. Both are for the next tick or a person.
      this.logger.warn(
        `Could not update the branch of PR #${pull.number}: ${error instanceof Error ? error.message : String(error)}`,
      );

      return 'update-failed';
    }

    await this.notifier.send(
      `🔄 PR #${pull.number}: подтянул свежий ${pull.baseRef} в ветку, CI запустится заново\n${parent.prUrl ?? ''}`.trim(),
    );

    return 'updated';
  }

  // The branch conflicts with the base. A worker only gets a snapshot of the branch, never `main`, so it cannot merge; what can be done
  // without a person is to do the issue again on today's base — if the owner switched that on (it closes a PR). Otherwise announced once.
  private async onConflict(
    parent: ImproveRun,
    pull: { number: number; headSha: string; baseRef: string },
    settings: { autoRedoConflicts?: boolean } | null,
  ): Promise<string> {
    const key = `${pull.number}:${pull.headSha}`;

    if (this.freshened.has(key)) return 'conflict';

    this.freshened.add(key);

    if (settings?.autoRedoConflicts) {
      try {
        const run = await this.improve.redoOnConflict(parent);

        await this.notifier.send(
          `♻️ PR #${pull.number} конфликтует с ${pull.baseRef} — закрыл его и запустил задачу заново на свежем ${pull.baseRef} (запуск #${run.id})\n${parent.prUrl ?? ''}`.trim(),
        );

        return 'redo';
      } catch (error) {
        // Already redone once, or another run of the issue is going: fall through to asking a person.
        this.logger.warn(
          `Could not redo PR #${pull.number}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    await this.notifier.send(
      `⚠️ PR #${pull.number}: конфликт с ${pull.baseRef} — нужен человек\n${parent.prUrl ?? ''}`.trim(),
    );

    return 'conflict';
  }
}
