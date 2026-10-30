import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';

import { AppLogService } from '../logs/app-log.service';
import { JobModel } from '../worker/entities/job.entity';
import { WorkerService } from '../worker/worker.service';
import { ImproveSettings } from './entities/improve-settings.entity';
import { FilingLimits, limitsFromSettings } from './improve-throttle';
import { ADVANCE_EVERY_MS, AUTOSTART_MIN_AGE_SECONDS } from './improve.service';
import { message, requireImproveModel } from './improve-shared';

// Reports pushes → worker at once: the per-account Improve settings and the poller that
// starts a job for each parcel pushed from Subscription while auto-start is on.
@Injectable()
export class ImproveAutoStartService {
  private readonly logger = new Logger(ImproveAutoStartService.name);
  private autoStarting = false;

  constructor(
    @InjectRepository(ImproveSettings)
    private readonly settings: Repository<ImproveSettings>,
    private readonly workers: WorkerService,
    private readonly appLogs: AppLogService,
  ) {}

  async getSettings(userId: number): Promise<ImproveSettings | null> {
    return this.settings.findOne({ where: { userId } });
  }

  async saveSettings(
    userId: number,
    autoStartModel: string | null,
    autoRepairCi?: boolean,
  ): Promise<ImproveSettings> {
    if (autoStartModel) requireImproveModel(autoStartModel);

    const existing = await this.getSettings(userId);
    const enabling = autoStartModel && !existing?.autoStartModel;

    return this.settings.save({
      userId,
      autoStartModel,
      // Left alone when the caller did not send it (the page saves the two settings separately).
      autoRepairCi: autoRepairCi ?? existing?.autoRepairCi ?? true,
      autoStartSince: autoStartModel
        ? enabling
          ? new Date()
          : (existing?.autoStartSince ?? new Date())
        : null,
    });
  }

  // The brake on automatic issue filing; the defaults when the account never saved settings.
  async getFilingLimits(userId: number): Promise<FilingLimits> {
    return limitsFromSettings(await this.getSettings(userId));
  }

  // Only the fields given are changed; the account's other switches stay as they are.
  async saveFilingLimits(
    userId: number,
    changes: Partial<FilingLimits>,
  ): Promise<FilingLimits> {
    const existing = await this.getSettings(userId);
    const next = { ...(await this.getFilingLimits(userId)) };

    for (const key of Object.keys(next) as Array<keyof FilingLimits>) {
      if (changes[key] !== undefined) next[key] = changes[key] as number;
    }

    await this.settings.save({
      userId,
      autoStartModel: existing?.autoStartModel ?? null,
      autoStartSince: existing?.autoStartSince ?? null,
      autoRepairCi: existing?.autoRepairCi ?? true,
      ...next,
    });

    return next;
  }

  // A parcel pushed from Subscription (channel "issue", outbound, unencrypted) that no
  // job has picked up yet, for an account that switched auto-start on, starts a job.
  @Interval(ADVANCE_EVERY_MS)
  async autoStartParcels(): Promise<void> {
    if (this.autoStarting) return;

    this.autoStarting = true;

    try {
      const accounts = await this.settings.find({
        where: { autoStartModel: Not(IsNull()) },
      });
      const rows: Array<{ fileId: number; userId: number; model: string }> = [];

      for (const account of accounts) {
        if (!account.autoStartModel || !account.autoStartSince) continue;

        const parcels = await this.workers.findUnstartedIssueParcels(
          account.userId,
          account.autoStartSince,
          AUTOSTART_MIN_AGE_SECONDS,
          'improve:',
        );
        for (const parcel of parcels) {
          rows.push({
            fileId: parcel.id,
            userId: account.userId,
            model: account.autoStartModel,
          });
        }
      }

      for (const row of rows) {
        await this.workers
          .create(row.userId, {
            sourceFileId: row.fileId,
            model: row.model as JobModel,
          })
          .then((job) =>
            this.log(
              'info',
              'improve.auto_started',
              `Parcel ${row.fileId} → job ${job.id} (${row.model})`,
              { fileId: row.fileId, jobId: job.id },
            ),
          )
          .catch((error) =>
            this.logger.warn(
              `Auto-start of parcel ${row.fileId} failed: ${message(error)}`,
            ),
          );
      }
    } finally {
      this.autoStarting = false;
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
