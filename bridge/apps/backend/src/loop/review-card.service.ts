import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { ImproveRun } from '../improve/entities/improve-run.entity';
import { Job } from '../worker/entities/job.entity';
import { GithubApiService } from './github-api.service';
import { findProtected } from './protected-paths';
import { buildReviewCard, type ReviewCard } from './review-card';

// Gathers what a review card is made of — the PR and its files from GitHub, the CI state, and the Improve runs and worker jobs behind it —
// and hands it to the pure builder. Read-only.
@Injectable()
export class ReviewCardService {
  constructor(
    private readonly github: GithubApiService,
    @InjectRepository(ImproveRun)
    private readonly runs: Repository<ImproveRun>,
    @InjectRepository(Job) private readonly jobs: Repository<Job>,
    private readonly config: ConfigService,
  ) {}

  async build(number: number): Promise<ReviewCard> {
    const pull = await this.github.getPull(number);
    const [files, ci, runs] = await Promise.all([
      this.github.listPullFileStats(number),
      this.github.ciState(pull.headSha),
      this.runs.find({ where: { prNumber: number } }),
    ]);
    const jobIds = runs
      .map((run) => run.jobId)
      .filter((id): id is number => id !== null);
    const jobs = jobIds.length
      ? await this.jobs.find({ where: { id: In(jobIds) } })
      : [];

    return buildReviewCard({
      number: pull.number,
      title: pull.title,
      url: pull.htmlUrl,
      base: pull.baseRef,
      body: pull.body ?? null,
      mergeable: pull.mergeable,
      ci,
      files,
      protectedHits: findProtected(files.map((file) => file.path)),
      runs: runs.map((run) => ({
        id: run.id,
        kind: run.kind,
        trigger: run.trigger,
        model: run.model,
        tier: run.routing?.tier ?? null,
        jobId: run.jobId,
        escalated: run.escalatedFromRunId !== null,
      })),
      jobs: jobs.map((job) => ({
        id: job.id,
        costUsd:
          typeof job.usage?.costUsd === 'number' ? job.usage.costUsd : null,
        seconds:
          job.startedAt && job.finishedAt
            ? Math.max(
                0,
                (job.finishedAt.getTime() - job.startedAt.getTime()) / 1000,
              )
            : null,
      })),
    });
  }

  /** Where the run's metrics are (the Improve page of this bridge), when its address is configured. */
  improveUrl(): string | undefined {
    const base = this.config.get<string>('BRIDGE_TARGET_URL');

    return base ? `${base.replace(/\/+$/, '')}/improve` : undefined;
  }
}
