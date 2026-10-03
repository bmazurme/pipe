import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { WorkerHeartbeat } from './entities/worker-heartbeat.entity';

export interface WorkerHeartbeatStatus {
  name: string;
  lastSeenAt: Date;
  isUp: boolean;
}

// How stale a heartbeat can be before the worker is considered "down" —
// generous relative to worker's own default poll interval (POLL_INTERVAL_SEC
// in worker/src/config.ts, default 10s) to absorb one slow or dropped poll
// without flapping between up/down on every page refresh.
const STALE_AFTER_MS = 30_000;

@Injectable()
export class WorkerHeartbeatService {
  constructor(
    @InjectRepository(WorkerHeartbeat)
    private readonly repository: Repository<WorkerHeartbeat>,
  ) {}

  async record(userId: number, workerName: string): Promise<void> {
    await this.repository.upsert(
      { userId, workerName, lastSeenAt: new Date() },
      ['userId', 'workerName'],
    );
  }

  async listForUser(userId: number): Promise<WorkerHeartbeatStatus[]> {
    const rows = await this.repository.find({ where: { userId } });
    const now = Date.now();

    return rows.map((row) => ({
      name: row.workerName,
      lastSeenAt: row.lastSeenAt,
      isUp: now - row.lastSeenAt.getTime() < STALE_AFTER_MS,
    }));
  }
}
