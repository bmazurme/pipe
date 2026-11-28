import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { DeploymentAccessService } from '../auth/deployment-access';
import { NotifyService } from '../telegram/notify.service';
import { KeyCheckReportDto } from './dto/rotation.dto';
import { KeyCopyCheck } from './entities/key-copy-check.entity';
import { RotationItem } from './entities/rotation-item.entity';
import { ReencryptService } from './reencrypt.service';
import {
  assessCopies,
  assessEncKey,
  assessItem,
  CATALOG,
  type CatalogEntry,
  type CopiesAssessment,
  type ItemAssessment,
  ROTATION_REMIND_DAYS,
  rotationAlert,
  type RotationKey,
  type RotationStatus,
  worst,
} from './rotation';

const SWEEP_EVERY_MS = 6 * 60 * 60_000;
const PENDING_CACHE_MS = 5 * 60_000;
const DAY = 86_400_000;

export interface RotationItemView extends ItemAssessment {
  key: RotationKey;
  label: string;
  effect: string;
  intervalDays: number;
  lastRotatedAt: string | null;
  // Only for the encryption key: values still under an older key (null = could not be counted).
  pendingValues?: number | null;
}

export interface RotationView {
  status: RotationStatus;
  items: RotationItemView[];
  keyCopies: {
    verified: number;
    status: RotationStatus;
    reasons: string[];
    copies: {
      label: string;
      ok: boolean;
      lastCheckAt: string;
      lastOkAt: string | null;
      backupCreatedAt: string | null;
      error: string | null;
    }[];
  };
}

@Injectable()
export class RotationService {
  private readonly logger = new Logger(RotationService.name);
  private pendingCache: { at: number; pending: number | null; current: string | null } | null = null;
  private sweeping = false;

  constructor(
    @InjectRepository(RotationItem)
    private readonly items: Repository<RotationItem>,
    @InjectRepository(KeyCopyCheck)
    private readonly checks: Repository<KeyCopyCheck>,
    private readonly reencrypt: ReencryptService,
    @Optional() private readonly notifier?: NotifyService,
    @Optional() private readonly access?: DeploymentAccessService,
  ) {}

  async view(userId: number, now = new Date()): Promise<RotationView> {
    const rows = await this.ensure(userId);
    const copyRows = await this.checks.find({ where: { userId }, order: { label: 'ASC' } });
    const pending = await this.pending(now);
    const copies = assessCopies(
      copyRows.map((row) => ({
        label: row.label,
        lastCheckAt: row.lastCheckAt,
        ok: row.ok,
        lastOkAt: row.lastOkAt,
        error: row.error,
      })),
      now,
    );

    const items = CATALOG.map((entry) => {
      const row = rows.find((r) => r.key === entry.key);
      const base = this.assess(entry, row?.lastRotatedAt ?? null, copies, now);
      const assessed = entry.key === 'enc-key' ? assessEncKey(base, pending.pending, pending.current) : base;

      return {
        key: entry.key,
        label: entry.label,
        effect: entry.effect,
        intervalDays: entry.intervalDays,
        lastRotatedAt: row?.lastRotatedAt ? row.lastRotatedAt.toISOString() : null,
        ...(entry.key === 'enc-key' ? { pendingValues: pending.pending } : {}),
        ...assessed,
      };
    });

    return {
      status: worst(...items.map((item) => item.status)),
      items,
      keyCopies: {
        verified: copies.verified,
        status: copies.status,
        reasons: copies.reasons,
        copies: copyRows.map((row) => ({
          label: row.label,
          ok: row.ok,
          lastCheckAt: row.lastCheckAt.toISOString(),
          lastOkAt: row.lastOkAt ? row.lastOkAt.toISOString() : null,
          backupCreatedAt: row.backupCreatedAt,
          error: row.error,
        })),
      },
    };
  }

  async markRotated(userId: number, key: string, at?: string, now = new Date()): Promise<void> {
    const entry = CATALOG.find((e) => e.key === key);

    if (!entry) throw new BadRequestException(`Unknown key "${key}"`);
    if (entry.intervalDays <= 0) {
      throw new BadRequestException('This key is judged by its verified copies, not by a date');
    }

    const when = at ? new Date(at) : now;

    if (when.getTime() > now.getTime() + DAY) {
      throw new BadRequestException('The date of a change cannot be in the future');
    }

    await this.ensure(userId);
    await this.items.update({ userId, key }, { lastRotatedAt: when, notifiedAt: null });
  }

  async recordKeyCheck(userId: number, dto: KeyCheckReportDto, now = new Date()): Promise<void> {
    const existing = await this.checks.findOne({ where: { userId, label: dto.label } });

    await this.checks.upsert(
      {
        userId,
        label: dto.label,
        lastCheckAt: now,
        ok: dto.ok,
        lastOkAt: dto.ok ? now : (existing?.lastOkAt ?? null),
        backupCreatedAt: dto.backupCreatedAt ?? existing?.backupCreatedAt ?? null,
        error: dto.ok ? null : (dto.error ?? null),
      },
      ['userId', 'label'],
    );

    // A copy that does not decrypt is found today; the weekly sweep would say it in days.
    if (!dto.ok && this.notifier) {
      await this.notifier.send(
        `🔑 Копия ключа age «${dto.label}» не расшифровала последний бэкап: ${dto.error || 'причина не названа'}. Порядок — docs/key-rotation.md.`,
        { urgent: true },
      );
    }
  }

  // Overdue rotations and failing key copies reach Telegram — once a week per item, because a reminder every six hours is how reminders get muted.
  @Interval(SWEEP_EVERY_MS)
  async sweep(now = new Date()): Promise<number> {
    if (this.sweeping || !this.notifier || !this.access) return 0;

    this.sweeping = true;

    try {
      const owner = await this.access.ownerId();

      if (owner === null) return 0;

      const view = await this.view(owner, now);
      const rows = await this.ensure(owner);
      let sent = 0;

      for (const item of view.items) {
        if (item.status !== 'bad') continue;

        const row = rows.find((r) => r.key === item.key);

        if (row?.notifiedAt && now.getTime() - row.notifiedAt.getTime() < ROTATION_REMIND_DAYS * DAY) continue;

        // Marked first: a failing send must not be retried every six hours.
        await this.items.update({ userId: owner, key: item.key }, { notifiedAt: now });
        await this.notifier.send(rotationAlert(item.label, item.reasons));
        sent += 1;
      }

      return sent;
    } catch (error) {
      this.logger.warn(`Rotation sweep failed: ${error instanceof Error ? error.message : String(error)}`);

      return 0;
    } finally {
      this.sweeping = false;
    }
  }

  private assess(
    entry: CatalogEntry,
    lastRotatedAt: Date | null,
    copies: CopiesAssessment,
    now: Date,
  ): ItemAssessment {
    if (entry.key === 'age-key') {
      return { status: copies.status, reasons: copies.reasons, dueAt: null, daysLeft: null };
    }

    return assessItem({ key: entry.key, intervalDays: entry.intervalDays, lastRotatedAt }, now);
  }

  private async pending(now: Date): Promise<{ pending: number | null; current: string | null }> {
    if (this.pendingCache && now.getTime() - this.pendingCache.at < PENDING_CACHE_MS) {
      return this.pendingCache;
    }

    let pending: number | null = null;
    let current: string | null = null;

    try {
      const status = await this.reencrypt.status();

      pending = status.pending;
      current = status.currentKeyId;
    } catch (error) {
      // A malformed CREDENTIALS_ENC_KEY_CURRENT is a configuration problem the rest of bridge will already be shouting about.
      this.logger.warn(`Could not count values under old keys: ${error instanceof Error ? error.message : String(error)}`);
    }

    this.pendingCache = { at: now.getTime(), pending, current };

    return this.pendingCache;
  }

  private async ensure(userId: number): Promise<RotationItem[]> {
    const rows = await this.items.find({ where: { userId } });
    const missing = CATALOG.filter((entry) => !rows.some((r) => r.key === entry.key));

    if (missing.length === 0) return rows;

    await this.items.upsert(
      missing.map((entry) => ({ userId, key: entry.key, lastRotatedAt: null, notifiedAt: null })),
      ['userId', 'key'],
    );

    return this.items.find({ where: { userId } });
  }
}
