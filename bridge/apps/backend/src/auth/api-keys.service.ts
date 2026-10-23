import { createHash, randomBytes } from 'crypto';

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { ApiKey } from './entities/api-key.entity';

// Distinct from anything else in the system (bridge's OAuth JWTs) so a guard can
// tell at a glance "this looks like one of ours" before doing a DB lookup.
export const API_KEY_PREFIX = 'brk_';
const TOKEN_BYTES = 24;
const PREFIX_DISPLAY_LENGTH = 12;

export type ApiKeyScope = 'boards';

export interface CreatedApiKey {
  id: number;
  name: string;
  prefix: string;
  scope: ApiKeyScope | null;
  token: string;
  createdAt: Date;
}

@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);

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

  async create(
    userId: number,
    name: string,
    scope: ApiKeyScope | null = null,
  ): Promise<CreatedApiKey> {
    const token = this.generateToken();
    const saved = await this.apiKeyRepository.save(
      this.apiKeyRepository.create({
        userId,
        name,
        prefix: token.slice(0, PREFIX_DISPLAY_LENGTH),
        keyHash: this.hashToken(token),
        scope,
        lastUsedAt: null,
        revokedAt: null,
      }),
    );

    return {
      id: saved.id,
      name: saved.name,
      prefix: saved.prefix,
      scope: saved.scope ?? null,
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
  async validate(
    rawToken: string,
  ): Promise<{ userId: number; scope: ApiKeyScope | null } | null> {
    if (!rawToken.startsWith(API_KEY_PREFIX)) {
      return null;
    }

    const apiKey = await this.apiKeyRepository.findOne({
      where: { keyHash: this.hashToken(rawToken), revokedAt: IsNull() },
    });

    if (!apiKey) {
      return null;
    }

    // Fire-and-forget: an unhandled rejection would terminate the process.
    void this.apiKeyRepository
      .update(apiKey.id, { lastUsedAt: new Date() })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Could not update API key lastUsedAt: ${message}`);
      });

    return { userId: apiKey.userId, scope: apiKey.scope ?? null };
  }

  async revoke(id: number, userId: number): Promise<boolean> {
    const result = await this.apiKeyRepository.update(
      { id, userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );

    return Boolean(result.affected);
  }
}
