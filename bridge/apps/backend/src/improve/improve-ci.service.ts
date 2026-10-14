import { Injectable, Logger } from '@nestjs/common';
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

    if ((await this.github.ciState(pull.headSha)) !== 'failure') return 'ci-ok';

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

    const run = await this.improve.startRepair(
      parent,
      {
        number: prNumber,
        headSha: pull.headSha,
        branch: parent.branch as string,
      },
      formatFailures(failed),
    );

    await this.notifier.send(
      `🛠 PR #${prNumber}: CI красный (${failed.map((check) => check.name).join(', ')}) — запускаю автоисправление, попытка ${repairs.length + 1} из ${MAX_REPAIRS_PER_PR} (запуск #${run.id})`,
    );

    return 'repair';
  }
}
