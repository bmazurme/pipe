import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { ImproveRun } from '../improve/entities/improve-run.entity';
import { NotifyService } from '../telegram/notify.service';
import { formatPrList, prNumbersFromSubjects } from './deploy-prs';
import { DeployRecord, DeployResult } from './entities/deploy-record.entity';
import { GithubApiService } from './github-api.service';
import { LoopControlService } from './loop-control.service';

export interface DeployReport {
  result: DeployResult;
  sha: string;
  previousSha?: string;
  detail?: string;
}

export interface DeployOutcome {
  prNumbers: number[];
  // True when this report stopped the automation.
  paused: boolean;
  // A report for a release already recorded with the same result (a retry): nothing was done again.
  duplicate: boolean;
}

@Injectable()
export class LoopDeployService {
  private readonly logger = new Logger(LoopDeployService.name);

  constructor(
    @InjectRepository(DeployRecord)
    private readonly records: Repository<DeployRecord>,
    @InjectRepository(ImproveRun)
    private readonly runs: Repository<ImproveRun>,
    private readonly github: GithubApiService,
    private readonly notifier: NotifyService,
    @Optional() private readonly control?: LoopControlService,
  ) {}

  // The deploying board says how a release went. A release that did not come up stops the automation (it would keep building on a main
  // that does not run) and tells the owner which pull requests were in it; one that went out is just recorded.
  async record(report: DeployReport): Promise<DeployOutcome> {
    const existing = await this.records.findOne({
      where: { sha: report.sha, result: report.result },
    });

    if (existing) {
      return { prNumbers: existing.prNumbers, paused: false, duplicate: true };
    }

    const prNumbers = await this.pullRequestsIn(report);

    await this.records.save(
      this.records.create({
        sha: report.sha,
        previousSha: report.previousSha ?? null,
        result: report.result,
        detail: report.detail?.slice(0, 500) ?? null,
        prNumbers,
      }),
    );

    if (report.result === 'deployed') {
      return { prNumbers, paused: false, duplicate: false };
    }

    const short = report.sha.slice(0, 7);
    const reason = `версия ${short} (${formatPrList(prNumbers)}) ${report.result === 'rolled_back' ? 'откатилась' : 'не поднялась'}`;

    if (prNumbers.length > 0) {
      await this.runs
        .update(
          { prNumber: In(prNumbers), kind: 'issue' },
          {
            note: `⚠️ Релиз ${short} с этим PR ${report.result === 'rolled_back' ? 'откатился' : 'не поднялся'} — проверьте, прежде чем повторять задачу`,
          },
        )
        .catch((error) =>
          this.logger.warn(
            `Could not mark the runs of ${formatPrList(prNumbers)}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
    }

    await this.control?.pause(reason, 'deploy');
    // Urgent: the cause is the last thing merged, and the next merge would deploy on top of it.
    await this.notifier.send(
      `⏸ ${reason}. Автоматика на паузе: новые анализы, расписания и работа с открытыми PR не стартуют. Разберитесь с релизом и нажмите /resume.`,
      { urgent: true },
    );

    return { prNumbers, paused: Boolean(this.control), duplicate: false };
  }

  // Best effort: a GitHub that cannot be asked gives an empty list, and the report is still stored and still pauses.
  private async pullRequestsIn(report: DeployReport): Promise<number[]> {
    if (!this.github.isReady()) return [];

    try {
      const subjects = await this.github.commitSubjects(
        report.previousSha,
        report.sha,
      );

      return prNumbersFromSubjects(subjects);
    } catch (error) {
      this.logger.warn(
        `Could not list the commits of ${report.sha.slice(0, 7)}: ${error instanceof Error ? error.message : String(error)}`,
      );

      return [];
    }
  }
}
