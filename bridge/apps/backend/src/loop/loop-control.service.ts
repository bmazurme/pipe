import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  LOOP_CONTROL_ID,
  LoopControl,
  LoopPausedBy,
} from './entities/loop-control.entity';

const CACHE_MS = 5_000;

export interface LoopControlState {
  paused: boolean;
  reason: string | null;
  pausedBy: LoopPausedBy | null;
  pausedAt: string | null;
}

@Injectable()
export class LoopControlService {
  private readonly logger = new Logger(LoopControlService.name);
  private cache: { at: number; value: LoopControlState } | null = null;

  constructor(
    @InjectRepository(LoopControl)
    private readonly repository: Repository<LoopControl>,
  ) {}

  async state(): Promise<LoopControlState> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) {
      return this.cache.value;
    }

    const row = await this.repository.findOne({
      where: { id: LOOP_CONTROL_ID },
    });
    const value: LoopControlState = {
      paused: row?.paused ?? false,
      reason: row?.paused ? (row.reason ?? null) : null,
      pausedBy: row?.paused ? (row.pausedBy ?? null) : null,
      pausedAt: row?.paused ? (row.pausedAt?.toISOString() ?? null) : null,
    };

    this.cache = { at: Date.now(), value };

    return value;
  }

  // Asked before anything starts new automatic work. Fails open: a broken switch must not freeze the automation for good — but it is
  // logged, and a person can see the state on the page.
  async isPaused(): Promise<boolean> {
    try {
      return (await this.state()).paused;
    } catch (error) {
      this.logger.warn(
        `Loop control unreadable, treating as running: ${error instanceof Error ? error.message : String(error)}`,
      );

      return false;
    }
  }

  async pause(reason: string | null, by: LoopPausedBy): Promise<void> {
    // The first pause keeps its reason: a later one (a second rollback) must not hide why it stopped.
    if ((await this.freshState()).paused) return;

    await this.repository.save({
      id: LOOP_CONTROL_ID,
      paused: true,
      reason: reason ? reason.slice(0, 300) : null,
      pausedBy: by,
      pausedAt: new Date(),
    });
    this.cache = null;
  }

  async resume(): Promise<boolean> {
    const was = (await this.freshState()).paused;

    await this.repository.save({
      id: LOOP_CONTROL_ID,
      paused: false,
      reason: null,
      pausedBy: null,
      pausedAt: null,
    });
    this.cache = null;

    return was;
  }

  private async freshState(): Promise<LoopControlState> {
    this.cache = null;

    return this.state();
  }
}
