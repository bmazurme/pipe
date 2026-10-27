import { createHash, randomBytes } from 'crypto';

import { Injectable } from '@nestjs/common';

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

// How the guard finds the worker a key hash belongs to. The module that owns workers registers it (see useLookup).
export type WorkerKeyLookup = (
  keyHash: string,
) => Promise<{ id: number; userId: number } | null>;

@Injectable()
export class WorkerKeysService {
  private lookup: WorkerKeyLookup | null = null;

  useLookup(lookup: WorkerKeyLookup): void {
    this.lookup = lookup;
  }

  // The worker a presented key belongs to, or null. A deleted worker's key simply stops matching;
  // until a lookup is registered nothing matches.
  async validate(rawKey: string): Promise<WorkerPrincipal | null> {
    if (!rawKey.startsWith(WORKER_KEY_PREFIX) || !this.lookup) {
      return null;
    }

    const worker = await this.lookup(hashSecret(rawKey));

    return worker ? { userId: worker.userId, workerId: worker.id } : null;
  }
}
