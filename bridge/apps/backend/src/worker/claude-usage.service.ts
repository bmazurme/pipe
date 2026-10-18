import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  type ClaudeLimits,
  sanitizeLimits,
  sanitizeUsage,
} from './claude-limits';
import { ClaudeCredentialsService } from './claude-credentials.service';
import { ReportUsageDto } from './dto/report-usage.dto';
import { Job } from './entities/job.entity';
import { Worker } from './entities/worker.entity';

@Injectable()
export class ClaudeUsageService {
  constructor(
    @InjectRepository(Job)
    private readonly jobRepository: Repository<Job>,
    @InjectRepository(Worker)
    private readonly workerRepository: Repository<Worker>,
    private readonly claudeCredentialsService: ClaudeCredentialsService,
  ) {}

  // What a worker reports after a Claude run: the plan limits (kept on the worker and, for a job on a named
  // token, on that token) and the job's tokens and cost. Everything is checked on the way in; garbage is dropped.
  async recordReport(
    userId: number,
    workerId: number | undefined,
    dto: ReportUsageDto,
    now = new Date(),
  ): Promise<{ limits: ClaudeLimits; credentialId: number | null } | null> {
    const limits = sanitizeLimits(dto.limits, now);
    const usage = sanitizeUsage(dto.usage);

    if (limits && workerId !== undefined) {
      await this.workerRepository.update(
        { id: workerId, userId },
        { claudeLimits: limits },
      );
    }

    if (dto.jobId === undefined) {
      if (!limits) return null;

      // A probe runs on the token the worker's jobs use (its own, else the account's first): the limits are that token's.
      if (dto.probe === true && workerId !== undefined) {
        const worker = await this.workerRepository.findOneBy({
          id: workerId,
          userId,
        });
        const token = await this.claudeCredentialsService.resolveForRun(
          userId,
          null,
          worker?.claudeCredentialId ?? null,
        );

        if (token) {
          await this.claudeCredentialsService.recordLimits(
            token.id,
            userId,
            limits,
          );
          await this.claudeCredentialsService.clearAuthFailed(token.id, userId);

          return { limits, credentialId: token.id };
        }
      }

      return { limits, credentialId: null };
    }

    await this.assertHeldBy(dto.jobId, userId, workerId);

    const job = await this.findOwned(dto.jobId, userId);

    if (usage) await this.jobRepository.update(job.id, { usage });

    const limitsCredentialId =
      job.claudeCredentialId ?? job.usedClaudeCredentialId ?? null;

    if (limits && limitsCredentialId !== null) {
      await this.claudeCredentialsService.recordLimits(
        limitsCredentialId,
        userId,
        limits,
      );
    }

    // Usage or limits only arrive from a run Anthropic accepted.
    if ((limits || usage) && limitsCredentialId !== null) {
      await this.claudeCredentialsService.clearAuthFailed(
        limitsCredentialId,
        userId,
      );
    }

    return limits ? { limits, credentialId: limitsCredentialId } : null;
  }

  async recordUsedCredential(
    jobId: number,
    userId: number,
    credentialId: number,
  ): Promise<void> {
    await this.jobRepository.update(jobId, {
      usedClaudeCredentialId: credentialId,
      usedClaudeCredentialName: await this.claudeCredentialsService.nameOf(
        credentialId,
        userId,
      ),
    });
  }

  // A worker added in the UI may only touch the jobs it holds (a personal API key keeps its account-wide reach).
  private async assertHeldBy(
    id: number,
    userId: number,
    workerId: number | undefined,
  ): Promise<void> {
    if (workerId === undefined) return;

    const job = await this.findOwned(id, userId);

    if (job.workerId !== workerId) {
      throw new ForbiddenException('This job is not held by this worker');
    }
  }

  private async findOwned(id: number, userId: number): Promise<Job> {
    const job = await this.jobRepository.findOne({ where: { id, userId } });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    return job;
  }
}
