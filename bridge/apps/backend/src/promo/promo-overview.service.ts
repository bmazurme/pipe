import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';

import { PromoPost } from './entities/promo-post.entity';
import {
  PROMO_CHANNELS,
  PROMO_POST_STATUSES,
  type PromoChannel,
  type PromoPostStatus,
} from './promo-limits';
import { PromoLandingService } from './promo-landing.service';
import {
  type TelegramState,
  PromoTelegramService,
} from './promo-telegram.service';

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
  // Where Telegram posts go: the bound channel and group (and the chats the bot has seen, for binding more).
  telegram: TelegramState;
}

@Injectable()
export class PromoOverviewService {
  constructor(
    @InjectRepository(PromoPost)
    private readonly posts: Repository<PromoPost>,
    private readonly landing: PromoLandingService,
    private readonly promoTelegram: PromoTelegramService,
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
    const telegram = await this.promoTelegram.state();

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
          ...this.readiness(channel, telegram),
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
      telegram,
    };
  }

  private readiness(
    channel: PromoChannel,
    telegram: TelegramState,
  ): Pick<ChannelOverview, 'autoPublish' | 'ready' | 'note'> {
    if (channel === 'telegram') {
      return {
        autoPublish: true,
        ready: telegram.botConfigured && telegram.news !== null,
        note: !telegram.botConfigured
          ? 'Не настроен бот (TELEGRAM_BOT_TOKEN)'
          : !telegram.news
            ? 'Канал новостей не привязан'
            : `Публикует в «${telegram.news.title ?? telegram.news.chatId}»${telegram.discussion ? `, обсуждение в «${telegram.discussion.title ?? telegram.discussion.chatId}»` : ''}`,
      };
    }

    return {
      autoPublish: false,
      ready: false,
      note: 'Пока только напоминания; автопубликация после аудита API',
    };
  }
}
