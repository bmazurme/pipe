import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import {
  AuthIdentity,
  AuthProvider,
  LEGACY_PROVIDER_ID_PREFIX,
} from './entities/auth-identity.entity';

export interface IdentityView {
  provider: AuthProvider;
  email: string | null;
  enabled: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export const LAST_METHOD_MESSAGE =
  'Нельзя отключить последний способ входа — сначала подключите и включите другой';

@Injectable()
export class IdentitiesService {
  constructor(
    @InjectRepository(AuthIdentity)
    private readonly repository: Repository<AuthIdentity>,
    private readonly dataSource: DataSource,
  ) {}

  async list(userId: number): Promise<IdentityView[]> {
    const rows = await this.repository.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });

    return rows.map((row) => ({
      provider: row.provider,
      email: row.email,
      enabled: row.enabled,
      lastUsedAt: row.lastUsedAt,
      createdAt: row.createdAt,
    }));
  }

  findByProviderUserId(
    provider: AuthProvider,
    providerUserId: string,
  ): Promise<AuthIdentity | null> {
    return this.repository.findOne({ where: { provider, providerUserId } });
  }

  /** The row the migration backfilled for an existing user, before the real provider id was known. */
  findLegacy(
    provider: AuthProvider,
    email: string,
  ): Promise<AuthIdentity | null> {
    return this.findByProviderUserId(
      provider,
      `${LEGACY_PROVIDER_ID_PREFIX}${email}`,
    );
  }

  findByUserAndProvider(
    userId: number,
    provider: AuthProvider,
  ): Promise<AuthIdentity | null> {
    return this.repository.findOne({ where: { userId, provider } });
  }

  async create(
    userId: number,
    provider: AuthProvider,
    providerUserId: string,
    email: string | null,
  ): Promise<AuthIdentity> {
    return this.repository.save(
      this.repository.create({
        userId,
        provider,
        providerUserId,
        email,
        enabled: true,
        lastUsedAt: new Date(),
      }),
    );
  }

  async markUsed(
    identity: AuthIdentity,
    providerUserId: string,
    email: string | null,
  ): Promise<void> {
    await this.repository.update(identity.id, {
      providerUserId,
      email: email ?? identity.email,
      lastUsedAt: new Date(),
    });
  }

  /**
   * Binds a provider account to an already signed-in user. Refuses when the
   * account belongs to somebody else, or when this user already has a
   * different account for that provider (unlink it first) — never silently
   * moves or replaces a link.
   */
  async link(
    userId: number,
    provider: AuthProvider,
    providerUserId: string,
    email: string | null,
  ): Promise<AuthIdentity> {
    const taken = await this.findByProviderUserId(provider, providerUserId);

    if (taken) {
      if (taken.userId === userId) {
        return taken;
      }
      throw new ConflictException(
        'Этот аккаунт уже привязан к другому пользователю',
      );
    }

    const own = await this.findByUserAndProvider(userId, provider);

    if (own) {
      throw new ConflictException(
        'У вас уже подключён другой аккаунт этого провайдера — сначала отвяжите его',
      );
    }

    return this.create(userId, provider, providerUserId, email);
  }

  async setEnabled(
    userId: number,
    provider: AuthProvider,
    enabled: boolean,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const rows = await this.lockUserIdentities(manager, userId);
      const target = rows.find((row) => row.provider === provider);

      if (!target) {
        throw new NotFoundException('Способ входа не подключён');
      }
      if (!enabled && target.enabled) {
        this.assertAnotherEnabled(rows, target);
      }

      await manager.update(AuthIdentity, target.id, { enabled });
    });
  }

  async unlink(userId: number, provider: AuthProvider): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const rows = await this.lockUserIdentities(manager, userId);
      const target = rows.find((row) => row.provider === provider);

      if (!target) {
        throw new NotFoundException('Способ входа не подключён');
      }
      if (target.enabled) {
        this.assertAnotherEnabled(rows, target);
      }

      await manager.delete(AuthIdentity, target.id);
    });
  }

  // Row locks serialise two simultaneous "disable" requests for the same
  // user — each one otherwise sees the other still enabled and both succeed,
  // leaving the account with no way in.
  private lockUserIdentities(
    manager: EntityManager,
    userId: number,
  ): Promise<AuthIdentity[]> {
    return manager.find(AuthIdentity, {
      where: { userId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  private assertAnotherEnabled(
    rows: AuthIdentity[],
    target: AuthIdentity,
  ): void {
    const others = rows.filter((row) => row !== target && row.enabled);

    if (others.length === 0) {
      throw new ConflictException(LAST_METHOD_MESSAGE);
    }
  }
}
