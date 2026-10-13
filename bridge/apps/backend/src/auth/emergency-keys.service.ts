import { createHash, randomBytes } from 'crypto';

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { EmergencyKey } from './entities/emergency-key.entity';

// A different prefix from personal API keys ('brk_'): JwtOrApiKeyGuard only looks at 'brk_', so an emergency token
// presented as an API key is simply not recognised — the two can never stand in for each other.
export const EMERGENCY_KEY_PREFIX = 'bre_';
const TOKEN_BYTES = 32;
const PREFIX_DISPLAY_LENGTH = 12;

export interface CreatedEmergencyKey {
  prefix: string;
  token: string;
  createdAt: Date;
}

export interface EmergencyKeyStatus {
  exists: boolean;
  prefix: string | null;
  createdAt: Date | null;
  lastUsedAt: Date | null;
}

@Injectable()
export class EmergencyKeysService {
  constructor(
    @InjectRepository(EmergencyKey)
    private readonly repository: Repository<EmergencyKey>,
  ) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  // The plaintext exists only in this return value (shown once); a new key replaces the old one in one statement,
  // so there is never a moment with two valid keys or none.
  async createOrReplace(userId: number): Promise<CreatedEmergencyKey> {
    const token = `${EMERGENCY_KEY_PREFIX}${randomBytes(TOKEN_BYTES).toString('base64url')}`;
    const prefix = token.slice(0, PREFIX_DISPLAY_LENGTH);

    await this.repository.upsert(
      { userId, prefix, keyHash: this.hash(token), lastUsedAt: null },
      ['userId'],
    );
    const saved = await this.repository.findOneByOrFail({ userId });

    return { prefix, token, createdAt: saved.updatedAt };
  }

  async status(userId: number): Promise<EmergencyKeyStatus> {
    const key = await this.repository.findOneBy({ userId });

    return {
      exists: key !== null,
      prefix: key?.prefix ?? null,
      createdAt: key?.updatedAt ?? null,
      lastUsedAt: key?.lastUsedAt ?? null,
    };
  }

  async revoke(userId: number): Promise<boolean> {
    const result = await this.repository.delete({ userId });

    return Boolean(result.affected);
  }

  // The owning userId for a presented key, or null. Marks the use (the owner sees "last used" in the profile).
  async redeem(rawToken: string): Promise<number | null> {
    if (!rawToken.startsWith(EMERGENCY_KEY_PREFIX)) {
      return null;
    }

    const key = await this.repository.findOneBy({
      keyHash: this.hash(rawToken),
    });

    if (!key) {
      return null;
    }

    await this.repository.update(key.id, { lastUsedAt: new Date() });

    return key.userId;
  }
}
