import { createHash } from 'crypto';

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, MoreThan, Repository } from 'typeorm';

import { Session } from './entities/session.entity';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// "Отсутствовало более 3 суток" on the Devices section — a device that
// hasn't been seen in this long auto-ends its session rather than waiting
// out the full 7-day SESSION_TTL_MS, which only bounds how long an unused
// refresh token stays valid, not how long a stale session is shown as active.
const STALE_SESSION_MS = 3 * 24 * 60 * 60 * 1000;

// How long a just-rotated-out refresh token still validates. Refresh token
// rotation is a single-use scheme by design, but a client can legitimately
// present the same soon-to-be-stale cookie twice in quick succession — two
// browser tabs whose access tokens expire together, or a poller's request
// landing next to a manual one. Without this window, the loser of that race
// gets told its token is invalid and the app logs the user out from under
// them, even though the winner's rotation just succeeded. Kept short: this
// is a grace period for a genuine race, not a general tolerance for reuse —
// a token presented well outside this window has either already been used
// (this same grace path) or is a stale/replayed one, and is correctly
// rejected either way.
const REFRESH_GRACE_MS = 10_000;

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

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
    // The row's current hash becomes the grace-window "previous" hash before
    // being overwritten — createSession seeds refreshTokenHash as '', which
    // never matches a real sha256 digest, so the very first attach (sign-in)
    // harmlessly carries that empty value forward rather than needing a
    // special case.
    const current = await this.sessionRepository.findOne({
      where: { id: sessionId },
      select: { refreshTokenHash: true },
    });

    await this.sessionRepository.update(sessionId, {
      refreshTokenHash: this.hashToken(refreshToken),
      previousRefreshTokenHash: current?.refreshTokenHash ?? null,
      previousRefreshTokenExpiresAt: new Date(Date.now() + REFRESH_GRACE_MS),
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

    if (!session) {
      return null;
    }

    const presentedHash = this.hashToken(refreshToken);

    if (session.refreshTokenHash === presentedHash) {
      return session;
    }

    const withinGraceWindow =
      session.previousRefreshTokenHash === presentedHash &&
      session.previousRefreshTokenExpiresAt !== null &&
      session.previousRefreshTokenExpiresAt.getTime() > Date.now();

    if (withinGraceWindow) {
      this.logger.debug(
        `Session ${sessionId} validated via refresh grace window (concurrent rotation)`,
      );
      return session;
    }

    return null;
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

  // lastUsedAt is set on every session creation and refresh-token rotation
  // (createSession, attachRefreshToken), so it's never null in practice —
  // a plain LessThan comparison is enough, no fallback to createdAt needed.
  async revokeStaleSessions(): Promise<number> {
    const cutoff = new Date(Date.now() - STALE_SESSION_MS);
    const result = await this.sessionRepository.update(
      { revokedAt: IsNull(), lastUsedAt: LessThan(cutoff) },
      { revokedAt: new Date() },
    );

    return result.affected ?? 0;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleStaleSessionsCron(): Promise<void> {
    const revoked = await this.revokeStaleSessions();
    if (revoked > 0) {
      this.logger.log(`Revoked ${revoked} session(s) idle for over 3 days`);
    }
  }
}
