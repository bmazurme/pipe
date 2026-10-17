import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';

import type { ClaudeLimits } from './claude-limits';
import { ClaudeCredential } from './entities/claude-credential.entity';
import { Job } from './entities/job.entity';

export interface RecentClaudeUsage {
  runs: number;
  /** null when no run in the window reported a cost. */
  costUsd: number | null;
  tokens: number;
}

@Injectable()
export class ClaudeCredentialsService {
  constructor(
    @InjectRepository(ClaudeCredential)
    private readonly repository: Repository<ClaudeCredential>,
    @InjectRepository(Job)
    private readonly jobRepository: Repository<Job>,
  ) {}

  // Runs, cost and tokens of the user's jobs created since `since`, per token the job actually ran on. Tokens with
  // no runs are absent from the map; jobs whose token was deleted (null id) are left out.
  async recentUsage(
    userId: number,
    since: Date,
  ): Promise<Map<number, RecentClaudeUsage>> {
    const rows: {
      credentialId: number | string;
      runs: string;
      costUsd: string | null;
      tokens: string | null;
    }[] = await this.jobRepository
      .createQueryBuilder('job')
      .select('job.usedClaudeCredentialId', 'credentialId')
      .addSelect('COUNT(*)', 'runs')
      .addSelect("SUM((job.usage->>'costUsd')::numeric)", 'costUsd')
      .addSelect(
        "SUM(COALESCE((job.usage->>'inputTokens')::numeric, 0) + COALESCE((job.usage->>'outputTokens')::numeric, 0) + COALESCE((job.usage->>'cacheReadTokens')::numeric, 0) + COALESCE((job.usage->>'cacheCreationTokens')::numeric, 0))",
        'tokens',
      )
      .where('job.userId = :userId', { userId })
      .andWhere('job.usage IS NOT NULL')
      .andWhere('job.usedClaudeCredentialId IS NOT NULL')
      .andWhere('job.createdAt >= :since', { since })
      .groupBy('job.usedClaudeCredentialId')
      .getRawMany();

    return new Map(
      rows.map((row) => [
        Number(row.credentialId),
        {
          runs: Number(row.runs),
          costUsd: row.costUsd === null ? null : Number(row.costUsd),
          tokens: Number(row.tokens ?? 0),
        },
      ]),
    );
  }

  // The plan limits a run on this token reported; best-effort, so a deleted token is simply ignored.
  async recordLimits(
    id: number,
    userId: number,
    limits: ClaudeLimits,
  ): Promise<void> {
    await this.repository.update({ id, userId }, { limits });
  }

  // A job on this token was refused by Anthropic; best-effort like recordLimits.
  async markAuthFailed(
    id: number,
    userId: number,
    jobId: number,
  ): Promise<void> {
    await this.repository.update(
      { id, userId },
      { authFailedAt: new Date(), authFailedJobId: jobId },
    );
  }

  // A later run on the token worked, so the rejected mark no longer holds.
  async clearAuthFailed(id: number, userId: number): Promise<void> {
    await this.repository.update(
      { id, userId, authFailedAt: Not(IsNull()) },
      { authFailedAt: null, authFailedJobId: null },
    );
  }

  async create(
    userId: number,
    name: string,
    token: string,
  ): Promise<ClaudeCredential> {
    return this.repository.save(
      this.repository.create({ userId, name, token }),
    );
  }

  // Ascending id — the oldest (first added) credential is the frontend's
  // default pick, so this order is load-bearing, not cosmetic.
  async findAllByUser(userId: number): Promise<ClaudeCredential[]> {
    return this.repository.find({ where: { userId }, order: { id: 'ASC' } });
  }

  async remove(id: number, userId: number): Promise<void> {
    const result = await this.repository.delete({ id, userId });

    if (!result.affected) {
      throw new NotFoundException('Claude credential not found');
    }
  }

  // The token a Claude run uses: the one the job picked, else the one the worker is set to use, else (also when
  // those were deleted) the account's first — what the Claude-tokens card promises. null only when the account has none; the worker then falls back
  // to its own login, which a worker added in the UI does not have.
  async resolveForRun(
    userId: number,
    credentialId: number | null,
    workerCredentialId: number | null = null,
  ): Promise<{ id: number; token: string } | null> {
    for (const id of [credentialId, workerCredentialId]) {
      if (id === null) continue;

      const token = await this.resolveToken(id, userId);

      if (token) return { id, token };
    }

    const first = await this.repository.findOne({
      where: { userId },
      order: { id: 'ASC' },
    });

    return first ? { id: first.id, token: first.token } : null;
  }

  async nameOf(id: number, userId: number): Promise<string | null> {
    const credential = await this.repository.findOne({
      where: { id, userId },
      select: { id: true, name: true },
    });

    return credential?.name ?? null;
  }

  // The one place the raw token value leaves this service — called only by
  // WorkerService.claim() to hand it to the worker process, scoped to the
  // owning user so one account can never pull another's credential by id.
  async resolveToken(id: number, userId: number): Promise<string | null> {
    const credential = await this.repository.findOne({
      where: { id, userId },
    });

    return credential?.token ?? null;
  }
}
