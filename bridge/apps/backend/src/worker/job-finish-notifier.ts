import { Injectable, Logger, Optional } from '@nestjs/common';

import { DeploymentAccessService } from '../auth/deployment-access';
import { NotifyService } from '../telegram/notify.service';
import { Job, JobStatus } from './entities/job.entity';

@Injectable()
export class JobFinishNotifier {
  private readonly logger = new Logger(JobFinishNotifier.name);

  constructor(
    @Optional() private readonly notifyService?: NotifyService,
    @Optional() private readonly deploymentAccess?: DeploymentAccessService,
  ) {}

  // Opt-in, per job: one Telegram message when a job ends. Telegram has a single recipient,
  // so only the deployment owner's flag counts. Best-effort — never changes the outcome.
  async notify(job: Job): Promise<void> {
    if (!job.notifyOnFinish || !this.notifyService || !this.deploymentAccess) {
      return;
    }

    try {
      if (!(await this.deploymentAccess.isOwner(job.userId))) return;

      const text =
        job.status === JobStatus.Succeeded
          ? `✅ Задача #${job.id} (${job.model}) завершена`
          : `🔴 Задача #${job.id} (${job.model}) не выполнена: ${(job.errorMessage ?? '').slice(0, 200)}`;

      await this.notifyService.send(text);
    } catch (error) {
      this.logger.warn(
        `Failed to notify about job ${job.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
