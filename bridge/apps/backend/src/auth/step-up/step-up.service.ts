import { createHash } from 'node:crypto';

import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { AppLogService } from '../../logs/app-log.service';
import { NotifyService } from '../../telegram/notify.service';
import { UsersService } from '../../users/users.service';
import { RecoveryCode } from '../entities/recovery-code.entity';
import { UserTotp } from '../entities/user-totp.entity';
import {
  generateRecoveryCode,
  generateTotpSecret,
  normalizeRecoveryCode,
  otpauthUri,
  verifyTotp,
} from './totp';

export const STEP_UP_TTL_SECONDS = 5 * 60;
export const RECOVERY_CODE_COUNT = 10;
// Three wrong codes in a row raise an alarm; five lock the factor for a while (the throttle on the route is the
// first line, this is the one that cannot be bypassed by changing address).
export const ALERT_AFTER_FAILURES = 3;
export const LOCK_AFTER_FAILURES = 5;
export const LOCK_MS = 5 * 60_000;
const ISSUER = 'pipe bridge';

export type FactorKind = 'totp' | 'recovery';

interface GrantPayload {
  sub: number;
  sid: number;
  typ: string;
}

const hashCode = (code: string): string =>
  createHash('sha256').update(code).digest('hex');

@Injectable()
export class StepUpService {
  private readonly failures = new Map<
    number,
    { count: number; lockedUntil: number }
  >();

  constructor(
    @InjectRepository(UserTotp)
    private readonly totps: Repository<UserTotp>,
    @InjectRepository(RecoveryCode)
    private readonly recoveryCodes: Repository<RecoveryCode>,
    private readonly jwt: JwtService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
    @Optional() private readonly notify?: NotifyService,
    @Optional() private readonly logs?: AppLogService,
  ) {}

  // STEP_UP_ENFORCE=true: an action that needs the second factor is refused while none is set up. Off by default so
  // that rolling this out does not lock the owner out of Secrets before they have enrolled.
  enforced(): boolean {
    return this.config.get<string>('STEP_UP_ENFORCE') === 'true';
  }

  // Audit trail: who did what, and with which result — never a code, a secret or a token.
  audit(
    level: 'info' | 'warn' | 'error',
    event: string,
    message: string,
    meta?: Record<string, unknown>,
  ): void {
    void this.logs?.record({ level, source: 'system', event, message, meta });
  }

  private alert(text: string): void {
    void this.notify?.send(text, { urgent: true });
  }

  async isEnabled(userId: number): Promise<boolean> {
    const row = await this.totps.findOne({ where: { userId } });

    return !!row?.enabledAt;
  }

  async status(userId: number) {
    const row = await this.totps.findOne({ where: { userId } });
    const enabled = !!row?.enabledAt;

    return {
      enabled,
      setupPending: !!row && !enabled,
      recoveryCodesLeft: enabled
        ? await this.recoveryCodes.count({
            where: { userId, usedAt: IsNull() },
          })
        : 0,
      enforced: this.enforced(),
    };
  }

  async setup(userId: number) {
    const existing = await this.totps.findOne({ where: { userId } });

    if (existing?.enabledAt) {
      throw new ConflictException('Two-factor protection is already on');
    }

    const user = await this.users.findById(userId);

    if (!user) throw new NotFoundException('User not found');

    const secret = generateTotpSecret();

    if (existing) {
      await this.totps.update(existing.id, { secret, lastStep: 0 });
    } else {
      await this.totps.save(
        this.totps.create({ userId, secret, enabledAt: null, lastStep: 0 }),
      );
    }

    return { secret, otpauthUri: otpauthUri(secret, user.email, ISSUER) };
  }

  // The first code proves the app holds the secret; only then does the protection start, and the recovery codes
  // are shown — once.
  async enable(userId: number, code: string): Promise<string[]> {
    const row = await this.totps.findOne({ where: { userId } });

    if (!row) throw new NotFoundException('Start the setup first');
    if (row.enabledAt) {
      throw new ConflictException('Two-factor protection is already on');
    }

    this.assertNotLocked(userId);

    const step = verifyTotp(row.secret, code, Date.now(), row.lastStep);

    if (step === null) this.fail(userId, 'enable');

    await this.totps.update(row.id, { enabledAt: new Date(), lastStep: step! });
    this.failures.delete(userId);
    this.audit('warn', 'stepup.enabled', 'Two-factor protection turned on', {
      userId,
    });
    this.alert('🔐 Двухфакторная защита включена.');

    return this.issueRecoveryCodes(userId);
  }

  async issueGrant(
    userId: number,
    sessionId: number,
    code: string,
  ): Promise<{ token: string; expiresAt: string }> {
    const kind = await this.verifyFactor(userId, code);
    const payload: GrantPayload = {
      sub: userId,
      sid: sessionId,
      typ: 'step-up',
    };
    const token = this.jwt.sign(payload, { expiresIn: STEP_UP_TTL_SECONDS });

    this.audit('info', 'stepup.granted', `Second factor accepted (${kind})`, {
      userId,
      kind,
    });

    return {
      token,
      expiresAt: new Date(
        Date.now() + STEP_UP_TTL_SECONDS * 1000,
      ).toISOString(),
    };
  }

  // A grant belongs to one user and one browser session and lives five minutes. It is a JWT, but one that
  // JwtStrategy never accepts as a login (no sessionId claim), and this check refuses a login token in turn (no `typ`).
  checkGrant(token: string, userId: number, sessionId: number): boolean {
    try {
      const payload = this.jwt.verify<GrantPayload>(token);

      return (
        payload.typ === 'step-up' &&
        payload.sub === userId &&
        payload.sid === sessionId
      );
    } catch {
      return false;
    }
  }

  async disable(userId: number, code: string): Promise<void> {
    await this.verifyFactor(userId, code);
    await this.recoveryCodes.delete({ userId });
    await this.totps.delete({ userId });
    this.audit('warn', 'stepup.disabled', 'Two-factor protection turned off', {
      userId,
    });
    this.alert('⚠️ Двухфакторная защита выключена.');
  }

  async regenerateRecoveryCodes(
    userId: number,
    code: string,
  ): Promise<string[]> {
    await this.verifyFactor(userId, code);
    await this.recoveryCodes.delete({ userId });
    this.audit(
      'warn',
      'stepup.recovery_regenerated',
      'Recovery codes replaced',
      {
        userId,
      },
    );

    return this.issueRecoveryCodes(userId);
  }

  /**
   * Checks a code of either kind for a user whose protection is on. A wrong one counts toward the alarm and the
   * lock; a right one spends itself (a TOTP step or a recovery code can be used once).
   */
  async verifyFactor(userId: number, code: string): Promise<FactorKind> {
    const row = await this.totps.findOne({ where: { userId } });

    if (!row?.enabledAt) {
      throw new ConflictException('Two-factor protection is not on');
    }

    this.assertNotLocked(userId);

    const step = verifyTotp(row.secret, code, Date.now(), row.lastStep);

    if (step !== null) {
      // The step is claimed in the database, not in memory: two requests racing with the same code cannot both win.
      const claimed = await this.totps
        .createQueryBuilder()
        .update(UserTotp)
        .set({ lastStep: step })
        .where('"userId" = :userId AND "lastStep" < :step', { userId, step })
        .execute();

      if (claimed.affected === 1) {
        this.failures.delete(userId);

        return 'totp';
      }
    } else {
      const recovery = normalizeRecoveryCode(code);

      if (recovery && (await this.spendRecoveryCode(userId, recovery))) {
        this.failures.delete(userId);

        return 'recovery';
      }
    }

    return this.fail(userId, 'verify');
  }

  private async spendRecoveryCode(
    userId: number,
    code: string,
  ): Promise<boolean> {
    const spent = await this.recoveryCodes
      .createQueryBuilder()
      .update(RecoveryCode)
      .set({ usedAt: new Date() })
      .where('"userId" = :userId AND "codeHash" = :hash AND "usedAt" IS NULL', {
        userId,
        hash: hashCode(code),
      })
      .execute();

    if (spent.affected !== 1) return false;

    const left = await this.recoveryCodes.count({
      where: { userId, usedAt: IsNull() },
    });

    this.audit('warn', 'stepup.recovery_used', 'A recovery code was used', {
      userId,
      left,
    });
    this.alert(`⚠️ Использован код восстановления 2FA. Осталось: ${left}.`);

    return true;
  }

  private async issueRecoveryCodes(userId: number): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
      generateRecoveryCode(),
    );

    await this.recoveryCodes.save(
      codes.map((code) =>
        this.recoveryCodes.create({
          userId,
          codeHash: hashCode(code),
          usedAt: null,
        }),
      ),
    );

    return codes;
  }

  private assertNotLocked(userId: number): void {
    const state = this.failures.get(userId);

    if (state && state.lockedUntil > Date.now()) {
      throw new HttpException(
        {
          code: 'STEP_UP_LOCKED',
          message: 'Too many wrong codes; try again in a few minutes',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private fail(userId: number, action: string): never {
    const previous = this.failures.get(userId);
    // A lock that has run out starts a fresh count.
    const base =
      previous &&
      previous.lockedUntil <= Date.now() &&
      previous.count >= LOCK_AFTER_FAILURES
        ? 0
        : (previous?.count ?? 0);
    const count = base + 1;
    const lockedUntil = count >= LOCK_AFTER_FAILURES ? Date.now() + LOCK_MS : 0;

    this.failures.set(userId, { count, lockedUntil });
    this.audit(
      'warn',
      'stepup.failed',
      `Wrong second-factor code (${action}), ${count} in a row`,
      {
        userId,
        count,
      },
    );

    if (count === ALERT_AFTER_FAILURES) {
      this.alert(
        `🚨 ${ALERT_AFTER_FAILURES} неверных кода 2FA подряд. Если это не вы — кто-то держит вашу сессию.`,
      );
    }

    if (lockedUntil) {
      this.audit(
        'error',
        'stepup.locked',
        'Second factor locked after repeated wrong codes',
        {
          userId,
        },
      );
      this.alert('🔒 2FA заблокирована на 5 минут после неверных кодов.');
    }

    // 403, not 401: a 401 makes the browser try to refresh the session and replay the request, which would count a
    // second wrong code.
    throw new ForbiddenException({
      code: 'STEP_UP_INVALID_CODE',
      message: 'Wrong code',
    });
  }
}
