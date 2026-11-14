import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';

import { TelegramService } from '../telegram/telegram.service';
import { PromoPost } from './entities/promo-post.entity';
import {
  PROMO_CHANNELS,
  PROMO_POST_STATUSES,
  type PromoChannel,
  type PromoPostStatus,
} from './promo-limits';
import { PromoLandingService } from './promo-landing.service';

export interface ChannelOverview {
  channel: PromoChannel;
  // Does bridge publish to it by itself (not only remind).
  autoPublish: boolean;
  // Can it do what it claims right now (the bot and the channel are configured, ...).
  ready: boolean;
  note: string;
  counts: Record<PromoPostStatus, number>;
  next: { id: number; title: string; scheduledAt: Date } | null;
}

export interface PromoOverview {
  channels: ChannelOverview[];
  landing: {
    configured: boolean;
    url: string | null;
    activeDirName: string | null;
    releases: number;
  };
}

@Injectable()
export class PromoOverviewService {
  constructor(
    @InjectRepository(PromoPost)
    private readonly posts: Repository<PromoPost>,
    private readonly landing: PromoLandingService,
    private readonly telegram: TelegramService,
    private readonly config: ConfigService,
  ) {}

  async overview(): Promise<PromoOverview> {
    const rows = await this.posts
      .createQueryBuilder('post')
      .select('post.channel', 'channel')
      .addSelect('post.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('post.channel')
      .addGroupBy('post.status')
      .getRawMany<{
        channel: PromoChannel;
        status: PromoPostStatus;
        count: string;
      }>();
    const upcoming = await this.posts.find({
      where: { status: 'approved', scheduledAt: MoreThanOrEqual(new Date(0)) },
      order: { scheduledAt: 'ASC' },
    });
    const landing = await this.landing.state();

    return {
      channels: PROMO_CHANNELS.map((channel) => {
        const counts = Object.fromEntries(
          PROMO_POST_STATUSES.map((status) => [status, 0]),
        ) as Record<PromoPostStatus, number>;

        for (const row of rows) {
          if (row.channel === channel) counts[row.status] = Number(row.count);
        }

        const next = upcoming.find(
          (post) => post.channel === channel && post.scheduledAt,
        );

        return {
          channel,
          ...this.readiness(channel),
          counts,
          next: next?.scheduledAt
            ? { id: next.id, title: next.title, scheduledAt: next.scheduledAt }
            : null,
        };
      }),
      landing: {
        configured: landing.configured,
        url: landing.url,
        activeDirName: landing.activeDirName,
        releases: landing.releases.length,
      },
    };
  }

  private readiness(
    channel: PromoChannel,
  ): Pick<ChannelOverview, 'autoPublish' | 'ready' | 'note'> {
    if (channel === 'telegram') {
      const bot = this.telegram.isConfigured();
      const target = Boolean(
        this.config.get<string>('PROMO_TELEGRAM_CHANNEL_ID'),
      );

      return {
        // The publisher itself is stage 2; until then a Telegram post is prepared here and posted by hand.
        autoPublish: false,
        ready: bot && target,
        note: !bot
          ? 'Не настроен бот (TELEGRAM_BOT_TOKEN)'
          : !target
            ? 'Не задан канал (PROMO_TELEGRAM_CHANNEL_ID)'
            : 'Готов; автопубликация появится на следующем этапе',
      };
    }

    return {
      autoPublish: false,
      ready: false,
      note: 'Пока только напоминания; автопубликация после аудита API',
    };
  }
}
