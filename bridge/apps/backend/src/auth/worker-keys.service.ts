import { createHash, randomBytes } from 'crypto';

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Worker } from '../worker/entities/worker.entity';

// A worker's own key — distinct from a personal API key ('brk_'): it is created at enrollment, lives only on the worker
// and is accepted only on the routes a worker needs (see WorkerKeyAllowed). One enrollment code is single-use ('brn_').
export const WORKER_KEY_PREFIX = 'brw_';
export const ENROLL_CODE_PREFIX = 'brn_';
const KEY_BYTES = 32;
const CODE_BYTES = 18;
const PREFIX_DISPLAY_LENGTH = 12;

export interface WorkerPrincipal {
  userId: number;
  workerId: number;
}

export function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function generateWorkerKey(): {
  key: string;
  prefix: string;
  hash: string;
} {
  const key = `${WORKER_KEY_PREFIX}${randomBytes(KEY_BYTES).toString('base64url')}`;

  return {
    key,
    prefix: key.slice(0, PREFIX_DISPLAY_LENGTH),
    hash: hashSecret(key),
  };
}

export function generateEnrollCode(): { code: string; hash: string } {
  const code = `${ENROLL_CODE_PREFIX}${randomBytes(CODE_BYTES).toString('base64url')}`;

  return { code, hash: hashSecret(code) };
}

@Injectable()
export class WorkerKeysService {
  constructor(
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
  ) {}

  // The worker a presented key belongs to, or null. A deleted worker's key simply stops matching.
  async validate(rawKey: string): Promise<WorkerPrincipal | null> {
    if (!rawKey.startsWith(WORKER_KEY_PREFIX)) {
      return null;
    }

    const worker = await this.workers.findOneBy({
      keyHash: hashSecret(rawKey),
    });

    return worker ? { userId: worker.userId, workerId: worker.id } : null;
  }
}
