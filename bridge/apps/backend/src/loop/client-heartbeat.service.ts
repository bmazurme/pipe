import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';

import { TelegramService } from '../telegram/telegram.service';
import { ClientHeartbeat } from './entities/client-heartbeat.entity';

// reports heartbeats every ~15s (see its autopilot); three misses in a row
// before declaring the contour down, so one slow poll doesn't page anyone.
const STALE_AFTER_MS = 60_000;
const SWEEP_EVERY_MS = 30_000;

@Injectable()
export class ClientHeartbeatService {
  private readonly logger = new Logger(ClientHeartbeatService.name);

  constructor(
    @InjectRepository(ClientHeartbeat)
    private readonly repository: Repository<ClientHeartbeat>,
    private readonly telegram: TelegramService,
  ) {}

  async record(userId: number, name: string, kind: string): Promise<void> {
    const existing = await this.repository.findOne({ where: { userId, name } });

    await this.repository.upsert(
      { userId, name, kind, lastSeenAt: new Date(), isUp: true },
      ['userId', 'name'],
    );

    // First sight, or back after being declared down.
    if (!existing || !existing.isUp) {
      await this.telegram.send(`🟢 ${kind} «${name}» онлайн`);
    }
  }

  @Interval(SWEEP_EVERY_MS)
  async sweep(): Promise<void> {
    try {
      const stale = await this.repository.find({
        where: {
          isUp: true,
          lastSeenAt: LessThan(new Date(Date.now() - STALE_AFTER_MS)),
        },
      });

      for (const row of stale) {
        row.isUp = false;
        await this.repository.save(row);
        await this.telegram.send(`🔴 ${row.kind} «${row.name}» оффлайн`);
      }
    } catch (error) {
      this.logger.warn(
        `Heartbeat sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async statusLines(): Promise<string[]> {
    const rows = await this.repository.find({ order: { name: 'ASC' } });

    return rows.map(
      (row) => `${row.isUp ? '🟢' : '🔴'} ${row.kind} «${row.name}»`,
    );
  }
}
