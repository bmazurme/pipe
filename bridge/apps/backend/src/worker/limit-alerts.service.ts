import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { NotifyService } from '../telegram/notify.service';
import type { ClaudeLimits } from './claude-limits';
import { ClaudeCredential } from './entities/claude-credential.entity';
import { LimitAlertState } from './entities/limit-alert-state.entity';
import { Worker } from './entities/worker.entity';
import {
  type AlertLevel,
  evaluateLimits,
  formatAlert,
  type WindowState,
} from './limit-alerts';

// Tells the owner (Telegram, through NotifyService — quiet hours apply) when a Claude plan window of a token or worker
// is running out. Fed by what workers report after a run; never throws into that path. LIMIT_ALERTS=off silences it.
@Injectable()
export class LimitAlertsService {
  private readonly logger = new Logger(LimitAlertsService.name);

  constructor(
    @InjectRepository(LimitAlertState)
    private readonly states: Repository<LimitAlertState>,
    @InjectRepository(ClaudeCredential)
    private readonly credentials: Repository<ClaudeCredential>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    private readonly notifier: NotifyService,
  ) {}

  async check(input: {
    userId: number;
    workerId?: number;
    credentialId: number | null;
    limits: ClaudeLimits;
  }): Promise<string[]> {
    if ((process.env.LIMIT_ALERTS ?? '').toLowerCase() === 'off') return [];

    try {
      return await this.run(input);
    } catch (error) {
      this.logger.warn(
        `Limit alert check failed: ${error instanceof Error ? error.message : String(error)}`,
      );

      return [];
    }
  }

  private async run(input: {
    userId: number;
    workerId?: number;
    credentialId: number | null;
    limits: ClaudeLimits;
  }): Promise<string[]> {
    const { userId, workerId, credentialId, limits } = input;

    // The limit belongs to the token when we know which one the run used, else to the worker.
    const ownerKey =
      credentialId !== null
        ? `${userId}:c${credentialId}`
        : workerId !== undefined
          ? `${userId}:w${workerId}`
          : null;

    if (ownerKey === null) return [];

    const row = await this.states.findOneBy({ ownerKey });
    const previous = (row?.windows ?? {}) as Record<string, WindowState>;
    const { alerts, state } = evaluateLimits(limits, previous);
    const stored = Object.fromEntries(
      Object.entries(state).map(([window, value]) => [
        window,
        { level: value.level as AlertLevel, resetsAt: value.resetsAt },
      ]),
    );

    // The state is saved first: if sending fails the owner misses one message, but a failing channel cannot turn into a
    // message on every report.
    if (
      alerts.length > 0 ||
      JSON.stringify(stored) !== JSON.stringify(previous)
    ) {
      await this.states.save(
        row
          ? { ...row, windows: stored }
          : this.states.create({ ownerKey, windows: stored }),
      );
    }

    if (alerts.length === 0) return [];

    const subject = await this.subject(userId, credentialId, workerId);
    const messages = alerts.map((alert) => formatAlert(alert, subject));

    for (const message of messages) await this.notifier.send(message);

    return messages;
  }

  private async subject(
    userId: number,
    credentialId: number | null,
    workerId?: number,
  ): Promise<string> {
    const parts: string[] = [];

    if (credentialId !== null) {
      const credential = await this.credentials.findOne({
        where: { id: credentialId, userId },
        select: { id: true, name: true },
      });

      parts.push(
        credential ? `токен «${credential.name}»` : `токен #${credentialId}`,
      );
    }

    if (workerId !== undefined) {
      const worker = await this.workers.findOne({
        where: { id: workerId, userId },
        select: { id: true, name: true },
      });

      if (worker) parts.push(`worker ${worker.name}`);
    }

    return parts.join(' · ') || 'аккаунт';
  }
}
