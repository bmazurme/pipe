import { createHash, randomBytes } from 'crypto';

import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { ApiKeyScope, DEFAULT_EXPIRY_DAYS } from './api-key-scope';
import { ApiKey } from './entities/api-key.entity';

// Distinct from anything else in the system (bridge's OAuth JWTs) so a guard can
// tell at a glance "this looks like one of ours" before doing a DB lookup.
export const API_KEY_PREFIX = 'brk_';
const TOKEN_BYTES = 24;
const PREFIX_DISPLAY_LENGTH = 12;

export type { ApiKeyScope };

export interface CreatedApiKey {
  id: number;
  name: string;
  prefix: string;
  scope: ApiKeyScope | null;
  token: string;
  expiresAt: Date | null;
  createdAt: Date;
}

const LAST_USED_TOUCH_EVERY_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

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
    // Not given = DEFAULT_EXPIRY_DAYS; null = never, which has to be asked for (S5).
    expiresInDays: number | null = DEFAULT_EXPIRY_DAYS,
  ): Promise<CreatedApiKey> {
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;
    const token = this.generateToken();
    const saved = await this.apiKeyRepository.save(
      this.apiKeyRepository.create({
        userId,
        name,
        prefix: token.slice(0, PREFIX_DISPLAY_LENGTH),
        keyHash: this.hashToken(token),
        scope,
        expiresAt,
        lastUsedAt: null,
        revokedAt: null,
        notifiedExpiringAt: null,
        notifiedStaleAt: null,
      }),
    );

    return {
      id: saved.id,
      name: saved.name,
      prefix: saved.prefix,
      scope: saved.scope ?? null,
      token,
      expiresAt: saved.expiresAt ?? null,
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

    if (
      apiKey.expiresAt &&
      new Date(apiKey.expiresAt).getTime() <= Date.now()
    ) {
      return null;
    }

    // Only shown on the Keys page, so a value under a minute old is as good as a fresh one.
    const lastUsed = apiKey.lastUsedAt
      ? new Date(apiKey.lastUsedAt).getTime()
      : 0;

    if (Date.now() - lastUsed >= LAST_USED_TOUCH_EVERY_MS) {
      // Fire-and-forget: an unhandled rejection would terminate the process.
      void this.apiKeyRepository
        .update(apiKey.id, { lastUsedAt: new Date() })
        .catch((error: unknown) => {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(`Could not update API key lastUsedAt: ${message}`);
        });
    }

    return { userId: apiKey.userId, scope: apiKey.scope ?? null };
  }

  // A new key in the place of an old one: the same name, scope and lifetime (a key that never expires stays so — that was a choice). The old one is
  // revoked and then LOOKED FOR among the active keys: a rotation that left the old key working would be worse than none, so if it is still
  // there the new key is revoked again and nothing changes. Null when the key is not the user's or already revoked.
  async rotate(id: number, userId: number): Promise<CreatedApiKey | null> {
    const old = await this.apiKeyRepository.findOne({
      where: { id, userId, revokedAt: IsNull() },
    });

    if (!old) return null;

    const lifetimeDays = old.expiresAt
      ? Math.max(
          1,
          Math.round(
            (new Date(old.expiresAt).getTime() -
              new Date(old.createdAt).getTime()) /
              DAY_MS,
          ),
        )
      : null;
    const created = await this.create(
      userId,
      old.name,
      old.scope ?? null,
      lifetimeDays,
    );
    const revoked = await this.revoke(old.id, userId);
    const stillActive = await this.apiKeyRepository.findOne({
      where: { keyHash: old.keyHash, revokedAt: IsNull() },
    });

    if (!revoked || stillActive) {
      await this.revoke(created.id, userId);

      throw new InternalServerErrorException(
        'The old key could not be revoked, so nothing was changed',
      );
    }

    return created;
  }

  // The keys the hygiene sweep looks at: active ones, with their reminder marks.
  findForHygiene(): Promise<ApiKey[]> {
    return this.apiKeyRepository.find({ where: { revokedAt: IsNull() } });
  }

  async markNotified(id: number, kind: 'stale' | 'expiring'): Promise<void> {
    await this.apiKeyRepository.update(
      id,
      kind === 'stale'
        ? { notifiedStaleAt: new Date() }
        : { notifiedExpiringAt: new Date() },
    );
  }

  async revoke(id: number, userId: number): Promise<boolean> {
    const result = await this.apiKeyRepository.update(
      { id, userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );

    return Boolean(result.affected);
  }
}
