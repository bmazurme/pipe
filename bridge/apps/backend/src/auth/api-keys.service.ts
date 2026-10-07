import { createHash, randomBytes } from 'crypto';

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { ApiKey } from './entities/api-key.entity';

// Distinct from anything else in the system (bridge's OAuth JWTs) so a guard can
// tell at a glance "this looks like one of ours" before doing a DB lookup.
export const API_KEY_PREFIX = 'brk_';
const TOKEN_BYTES = 24;
const PREFIX_DISPLAY_LENGTH = 12;

export interface CreatedApiKey {
  id: number;
  name: string;
  prefix: string;
  token: string;
  createdAt: Date;
}

@Injectable()
export class ApiKeysService {
  constructor(
    @InjectRepository(ApiKey)
    private readonly apiKeyRepository: Repository<ApiKey>,
  ) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private generateToken(): string {
    return `${API_KEY_PREFIX}${randomBytes(TOKEN_BYTES).toString('base64url')}`;
  }

  async create(userId: number, name: string): Promise<CreatedApiKey> {
    const token = this.generateToken();
    const saved = await this.apiKeyRepository.save(
      this.apiKeyRepository.create({
        userId,
        name,
        prefix: token.slice(0, PREFIX_DISPLAY_LENGTH),
        keyHash: this.hashToken(token),
        lastUsedAt: null,
        revokedAt: null,
      }),
    );

    return {
      id: saved.id,
      name: saved.name,
      prefix: saved.prefix,
      token,
      createdAt: saved.createdAt,
    };
  }

  async findActiveByUser(userId: number): Promise<ApiKey[]> {
    return this.apiKeyRepository.find({
      where: { userId, revokedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }

  // Returns the owning userId for a presented token, or null if it doesn't
  // match an active key. Bumps lastUsedAt on success (best-effort — a slow
  // write here shouldn't hold up the request it's authorizing).
  async validate(rawToken: string): Promise<{ userId: number } | null> {
    if (!rawToken.startsWith(API_KEY_PREFIX)) {
      return null;
    }

    const apiKey = await this.apiKeyRepository.findOne({
      where: { keyHash: this.hashToken(rawToken), revokedAt: IsNull() },
    });

    if (!apiKey) {
      return null;
    }

    void this.apiKeyRepository.update(apiKey.id, { lastUsedAt: new Date() });

    return { userId: apiKey.userId };
  }

  async revoke(id: number, userId: number): Promise<boolean> {
    const result = await this.apiKeyRepository.update(
      { id, userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );

    return Boolean(result.affected);
  }
}
