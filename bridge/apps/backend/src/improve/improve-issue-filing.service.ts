import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AppLogService } from '../logs/app-log.service';
import { GithubApiService } from '../loop/github-api.service';
import { issueBody, normalizeTitle } from './analysis';
import { ImproveRun, ImproveRunStatus } from './entities/improve-run.entity';
import { ImproveSettings } from './entities/improve-settings.entity';
import { AnalysisResult, message, PR_LABEL } from './improve-shared';
import {
  countOpenByCategory,
  limitsFromSettings,
  planFiling,
} from './improve-throttle';

// Turns an analysis's proposals into GitHub issues: duplicate detection, label
// warnings and partial-failure bookkeeping.
@Injectable()
export class ImproveIssueFilingService {
  // Set by ImproveService: called after this service changes the open-issue list on GitHub.
  onIssuesChanged?: () => void;

  constructor(
    @InjectRepository(ImproveRun)
    private readonly runs: Repository<ImproveRun>,
    private readonly github: GithubApiService,
    private readonly appLogs: AppLogService,
    // Read directly, not through ImproveAutoStartService: that file imports improve.service, which imports this one — a cycle Nest
    // cannot resolve (the dependency arrives undefined).
    @InjectRepository(ImproveSettings)
    private readonly settings: Repository<ImproveSettings>,
  ) {}

  // Files the run's proposals as issues, skipping any whose title matches an existing
  // issue. Records each item's outcome on the run and returns a one-line summary.
  async fileProposals(run: ImproveRun, only?: number[]): Promise<string> {
    const stored = JSON.parse(run.result ?? '{}') as AnalysisResult;
    const existing = new Map(
      (await this.github.listIssueTitles()).map((issue) => [
        normalizeTitle(issue.title),
        issue.number,
      ]),
    );
    let created = 0;
    let duplicates = 0;
    let held = 0;
    const unlabelled: number[] = [];
    let failure: Error | null = null;

    // Which proposals, in which order: best value per effort first, and not past the account's limits. A person who ticked specific
    // proposals (`only`) decides for themselves — the brake is for the automatic path.
    const order = only ? only : await this.planOrder(run, stored);

    for (const index of order) {
      const item = stored.items[index];

      if (!item) continue;
      if (item.issueNumber || item.duplicateOf) continue;

      const duplicate = existing.get(normalizeTitle(item.title));

      if (duplicate) {
        item.duplicateOf = duplicate;
        duplicates += 1;
        continue;
      }

      let issue: { number: number; missingLabels?: string[] };

      try {
        issue = await this.github.createIssue({
          title: item.title,
          body: issueBody(item),
          labels: [PR_LABEL, `risk:${item.risk}`, `category:${item.category}`],
        });
        this.onIssuesChanged?.();
      } catch (error) {
        failure = new Error(
          `Не удалось создать issue для «${item.title}» (предложение ${index + 1}): ${message(error)}; уже создано: ${created}`,
        );
        break;
      }

      item.issueNumber = issue.number;
      existing.set(normalizeTitle(item.title), issue.number);
      created += 1;

      if ((issue.missingLabels ?? []).includes(PR_LABEL)) {
        unlabelled.push(issue.number);
      }
    }

    held = stored.items.filter(
      (item) => item.skipped && !item.issueNumber,
    ).length;

    // Keep whatever was filed, even when a later proposal failed.
    run.result = JSON.stringify(stored);
    await this.runs.save(run);

    if (unlabelled.length > 0) {
      this.log(
        'warn',
        'improve.labels_missing',
        `Issues ${unlabelled.map((n) => `#${n}`).join(', ')} were created without the "${PR_LABEL}" label`,
        { runId: run.id },
      );
    }

    if (failure) throw failure;

    return `создано задач: ${created}${duplicates ? `, дубликатов пропущено: ${duplicates}` : ''}${held ? `, придержано по лимитам: ${held}` : ''}${unlabelled.length ? `; ⚠ без метки ${PR_LABEL}: ${unlabelled.map((n) => `#${n}`).join(', ')} — проверьте права токена (Issues: write)` : ''}`;
  }

  // The order to file an analysis's proposals in, with the ones held back by the account's limits marked on the item. If GitHub cannot be
  // asked what is already open, nothing is held back (filing will fail on its own if GitHub is really down).
  private async planOrder(
    run: ImproveRun,
    stored: AnalysisResult,
  ): Promise<number[]> {
    for (const item of stored.items) delete item.skipped;

    const limits = limitsFromSettings(
      await this.settings.findOne({ where: { userId: run.userId } }),
    );
    let openIssues: Awaited<ReturnType<GithubApiService['listOpenIssues']>> =
      [];

    try {
      openIssues = await this.github.listOpenIssues(PR_LABEL, 100);
    } catch (error) {
      this.log(
        'warn',
        'improve.limits_unchecked',
        `Could not list open issues to apply the filing limits: ${message(error)}`,
        { runId: run.id },
      );
    }

    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const plan = planFiling(
      stored.items,
      {
        openByCategory: countOpenByCategory(openIssues),
        filedLast24h: openIssues.filter(
          (issue) => Date.parse(issue.createdAt) >= dayAgo,
        ).length,
      },
      limits,
    );

    for (const [index, reason] of plan.skipped) {
      stored.items[index].skipped = reason;
    }

    return plan.order;
  }

  // The manual path for a reviewed analysis: file the chosen proposals.
  async createIssues(id: number, indices?: number[]): Promise<ImproveRun> {
    this.requireConfigured();

    const run = await this.runs.findOne({ where: { id, kind: 'analysis' } });

    if (!run) throw new NotFoundException('Analysis run not found');
    if (run.status !== ImproveRunStatus.Analyzed) {
      throw new ConflictException('Анализ ещё не завершён');
    }

    run.note = await this.fileProposals(run, indices);

    return this.runs.save(run);
  }

  // Files one issue the owner wrote by hand, labelled for Improve. Starting a run
  // on it is left to the caller (`start`), since ImproveService depends on this one.
  async createManualIssue(
    input: { title: string; body?: string },
    start?: (issueNumber: number) => Promise<ImproveRun>,
  ): Promise<{
    number: number;
    htmlUrl: string;
    missingLabels: string[];
    run?: ImproveRun;
  }> {
    this.requireConfigured();

    const issue = await this.github.createIssue({
      title: input.title,
      body: input.body ?? '',
      labels: [PR_LABEL],
    });
    this.onIssuesChanged?.();
    const result = {
      number: issue.number,
      htmlUrl: issue.htmlUrl,
      missingLabels: issue.missingLabels ?? [],
    };

    if (!start) return result;

    return { ...result, run: await start(issue.number) };
  }

  private requireConfigured(): void {
    if (!this.github.isReady()) {
      throw new BadRequestException(
        'GitHub не настроен: задайте GITHUB_REPO и LOOP_GITHUB_TOKEN на bridge',
      );
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
