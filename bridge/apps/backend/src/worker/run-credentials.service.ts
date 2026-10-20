import { Injectable } from '@nestjs/common';

import { ClaudeCredentialsService } from './claude-credentials.service';
import { ClaimedProviderDto } from './dto/provider-credential-response.dto';
import { CLAUDE_JOB_MODELS, JobModel } from './entities/job.entity';
import { ProviderCredentialsService } from './provider-credentials.service';
import { WorkersService } from './workers.service';

export interface RunCredentials {
  claudeToken: string | null;
  // The stored Claude token the run actually uses (null for a non-Claude model or when none resolved).
  claudeCredentialId: number | null;
  provider: ClaimedProviderDto | null;
}

// The one place that decides which secrets a claimed unit of work (a Worker job or a Chat turn) runs with: the
// credential the job picked, else the one in the worker's settings, else the account's first.
@Injectable()
export class RunCredentialsService {
  constructor(
    private readonly claudeCredentials: ClaudeCredentialsService,
    private readonly providerCredentials: ProviderCredentialsService,
    private readonly workers: WorkersService,
  ) {}

  async resolve(
    userId: number,
    workerId: number | undefined,
    model: string,
    picks: {
      claudeCredentialId?: number | null;
      providerCredentialId?: number | null;
    } = {},
  ): Promise<RunCredentials> {
    const resolved = CLAUDE_JOB_MODELS.includes(model as JobModel)
      ? await this.claudeCredentials.resolveForRun(
          userId,
          picks.claudeCredentialId ?? null,
          workerId === undefined
            ? null
            : await this.workers.claudeCredentialIdOf(workerId),
        )
      : null;

    return {
      claudeToken: resolved?.token ?? null,
      claudeCredentialId: resolved?.id ?? null,
      provider: await this.providerCredentials.resolveForJob(
        userId,
        model,
        picks.providerCredentialId ?? null,
      ),
    };
  }
}
