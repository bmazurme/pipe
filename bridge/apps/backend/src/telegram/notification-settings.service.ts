import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { NotificationSettings } from './entities/notification-settings.entity';
import {
  DEFAULT_QUIET_HOURS,
  DEFAULT_QUIET_TIMEZONE,
  isQuietNow,
  parseQuietHours,
  QuietWindow,
} from './quiet-hours';

const CACHE_MS = 30_000;

export interface EffectiveNotificationSettings {
  quietHours: string;
  timezone: string;
  window: QuietWindow | null;
  quietWeekends: boolean;
  allowUrgent: boolean;
  // Where the values came from: an account's saved settings, or the env defaults.
  source: 'profile' | 'default';
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });

    return true;
  } catch {
    return false;
  }
}

// The notification chat is a single owner chat, so the account whose settings
// apply is the owner's: the lowest user id that has saved any. Until someone
// saves, NOTIFY_QUIET_HOURS / NOTIFY_TIMEZONE (then the built-in defaults) apply,
// exactly as before this was editable.
@Injectable()
export class NotificationSettingsService {
  private cache: { at: number; value: EffectiveNotificationSettings } | null =
    null;

  constructor(
    @InjectRepository(NotificationSettings)
    private readonly repository: Repository<NotificationSettings>,
    private readonly configService: ConfigService,
  ) {}

  async effective(): Promise<EffectiveNotificationSettings> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) {
      return this.cache.value;
    }

    const owner = await this.repository.findOne({
      where: {},
      order: { userId: 'ASC' },
    });
    const quietHours =
      owner?.quietHours ??
      (this.configService.get<string>('NOTIFY_QUIET_HOURS') ||
        DEFAULT_QUIET_HOURS);
    const timezone =
      owner?.timezone ??
      (this.configService.get<string>('NOTIFY_TIMEZONE') ||
        DEFAULT_QUIET_TIMEZONE);
    const value: EffectiveNotificationSettings = {
      quietHours,
      timezone,
      window: parseQuietHours(quietHours),
      quietWeekends: owner?.quietWeekends ?? false,
      allowUrgent: owner?.allowUrgent ?? true,
      source: owner ? 'profile' : 'default',
    };

    this.cache = { at: Date.now(), value };

    return value;
  }

  // What the profile page shows for the signed-in account: their own saved
  // values, or — if they have none — what is currently in effect.
  async forUser(userId: number): Promise<{
    quietHours: string;
    timezone: string;
    isCustom: boolean;
    appliesToChat: boolean;
    isQuietNow: boolean;
    quietWeekends: boolean;
    allowUrgent: boolean;
  }> {
    const own = await this.repository.findOne({ where: { userId } });
    const effective = await this.effective();
    const owner = await this.repository.findOne({
      where: {},
      order: { userId: 'ASC' },
    });

    return {
      quietHours: own?.quietHours ?? effective.quietHours,
      timezone: own?.timezone ?? effective.timezone,
      quietWeekends: own?.quietWeekends ?? effective.quietWeekends,
      allowUrgent: own?.allowUrgent ?? effective.allowUrgent,
      isCustom: Boolean(own),
      // Only the owner's row drives the shared chat.
      appliesToChat: !owner || owner.userId === userId,
      isQuietNow: isQuietNow(
        effective.window,
        effective.timezone,
        new Date(),
        effective.quietWeekends,
      ),
    };
  }

  async save(
    userId: number,
    quietHours: string,
    timezone: string,
    extra: { quietWeekends?: boolean; allowUrgent?: boolean } = {},
  ): Promise<void> {
    parseQuietHours(quietHours); // throws on a malformed window
    if (!isValidTimeZone(timezone)) {
      throw new Error(`Unknown time zone: ${timezone}`);
    }

    // Only what was sent is changed; the rest keeps its saved value (or the default for an account saving for the first time).
    await this.repository.upsert(
      {
        userId,
        quietHours,
        timezone,
        ...(extra.quietWeekends !== undefined
          ? { quietWeekends: extra.quietWeekends }
          : {}),
        ...(extra.allowUrgent !== undefined
          ? { allowUrgent: extra.allowUrgent }
          : {}),
      },
      ['userId'],
    );
    this.cache = null;
  }
}
