import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';

import { ImproveRun } from '../improve/entities/improve-run.entity';
import { LabRun } from '../lab/entities/lab-run.entity';
import { Job } from '../worker/entities/job.entity';
import { buildUsageReport, UsageReport, UsageRun } from './usage-report';

const DAY_MS = 24 * 60 * 60 * 1000;
export const MIN_DAYS = 1;
export const MAX_DAYS = 365;
// More than this many jobs in a window is far past a personal tool's use; the cap keeps one request from loading the table.
const MAX_JOBS = 20_000;

@Injectable()
export class UsageService {
  constructor(
    @InjectRepository(Job) private readonly jobs: Repository<Job>,
    @InjectRepository(ImproveRun)
    private readonly improveRuns: Repository<ImproveRun>,
    @InjectRepository(LabRun) private readonly labRuns: Repository<LabRun>,
  ) {}

  async report(
    userId: number,
    days: number,
    now = new Date(),
  ): Promise<UsageReport> {
    const from = new Date(now.getTime() - days * DAY_MS);
    // Only the columns the report needs: `logs` and the encrypted context are large.
    const jobs = await this.jobs.find({
      where: { userId, createdAt: MoreThanOrEqual(from) },
      select: {
        id: true,
        model: true,
        status: true,
        taskKey: true,
        startedAt: true,
        finishedAt: true,
        createdAt: true,
        usage: true,
      },
      order: { id: 'ASC' },
      take: MAX_JOBS,
    });
    const jobIds = jobs.map((job) => job.id);
    const [improve, lab] = jobIds.length
      ? await Promise.all([
          this.improveRuns.find({ where: { userId, jobId: In(jobIds) } }),
          this.labRuns.find({ where: { userId, jobId: In(jobIds) } }),
        ])
      : [[], []];
    const runs: UsageRun[] = [
      ...improve.map((run): UsageRun => ({
        jobId: run.jobId,
        kind: 'improve',
        runKind: run.kind,
        issueNumber: run.issueNumber,
        runId: run.id,
        title: run.issueTitle,
        status: run.status,
        prNumber: run.prNumber,
        prUrl: run.prUrl,
      })),
      ...lab.map((run): UsageRun => ({
        jobId: run.jobId,
        kind: 'lab',
        issueNumber: null,
        runId: run.id,
        title: run.title,
        status: run.status,
        prNumber: run.prNumber,
        prUrl: run.prUrl,
      })),
    ];

    return buildUsageReport(jobs, runs, { from, to: now });
  }
}
