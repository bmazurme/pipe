import { createHash } from 'crypto';

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';

import { Session } from './entities/session.entity';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class SessionsService {
  constructor(
    @InjectRepository(Session)
    private readonly sessionRepository: Repository<Session>,
  ) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async createSession(
    userId: number,
    userAgent: string | null,
    ip: string | null,
  ): Promise<Session> {
    return this.sessionRepository.save(
      this.sessionRepository.create({
        userId,
        userAgent,
        ip,
        refreshTokenHash: '',
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        lastUsedAt: new Date(),
        revokedAt: null,
      }),
    );
  }

  async attachRefreshToken(
    sessionId: number,
    refreshToken: string,
  ): Promise<void> {
    await this.sessionRepository.update(sessionId, {
      refreshTokenHash: this.hashToken(refreshToken),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      lastUsedAt: new Date(),
    });
  }

  async validateSession(
    sessionId: number,
    userId: number,
    refreshToken: string,
  ): Promise<Session | null> {
    const session = await this.sessionRepository.findOne({
      where: {
        id: sessionId,
        userId,
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
    });

    if (!session || session.refreshTokenHash !== this.hashToken(refreshToken)) {
      return null;
    }

    return session;
  }

  async isSessionActive(sessionId: number, userId: number): Promise<boolean> {
    const session = await this.sessionRepository.findOne({
      where: {
        id: sessionId,
        userId,
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      select: { id: true },
    });

    return Boolean(session);
  }

  async findActiveByUser(userId: number): Promise<Session[]> {
    return this.sessionRepository.find({
      where: { userId, revokedAt: IsNull(), expiresAt: MoreThan(new Date()) },
      order: { lastUsedAt: 'DESC' },
    });
  }

  async revoke(sessionId: number, userId: number): Promise<boolean> {
    const result = await this.sessionRepository.update(
      { id: sessionId, userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );

    return Boolean(result.affected);
  }
}
