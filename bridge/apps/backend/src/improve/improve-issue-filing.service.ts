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
import { AnalysisResult, message, PR_LABEL } from './improve-shared';

// Turns an analysis's proposals into GitHub issues: duplicate detection, label
// warnings and partial-failure bookkeeping.
@Injectable()
export class ImproveIssueFilingService {
  constructor(
    @InjectRepository(ImproveRun)
    private readonly runs: Repository<ImproveRun>,
    private readonly github: GithubApiService,
    private readonly appLogs: AppLogService,
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
    const unlabelled: number[] = [];
    let failure: Error | null = null;

    for (const [index, item] of stored.items.entries()) {
      if (only && !only.includes(index)) continue;
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

    return `создано задач: ${created}${duplicates ? `, дубликатов пропущено: ${duplicates}` : ''}${unlabelled.length ? `; ⚠ без метки ${PR_LABEL}: ${unlabelled.map((n) => `#${n}`).join(', ')} — проверьте права токена (Issues: write)` : ''}`;
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
