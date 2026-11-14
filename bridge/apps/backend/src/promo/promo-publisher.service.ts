import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';

import { PromoPost } from './entities/promo-post.entity';
import { PromoPostsService } from './promo-posts.service';
import { PromoTelegramService } from './promo-telegram.service';

const TICK_MS = 60_000;

// Sends the approved Telegram posts whose time has come. A post is CLAIMED first (approved → publishing in one conditional update), so
// the tick and a click on «Опубликовать сейчас» can never both send it; and a post still `publishing` after a restart is not sent again —
// bridge cannot know whether Telegram got it, so it is marked failed and the owner looks at the channel.
@Injectable()
export class PromoPublisherService implements OnModuleInit {
  private readonly logger = new Logger(PromoPublisherService.name);
  private ticking = false;

  constructor(
    @InjectRepository(PromoPost) private readonly posts: Repository<PromoPost>,
    private readonly postsService: PromoPostsService,
    private readonly telegram: PromoTelegramService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const stuck = await this.posts.update(
        { status: 'publishing' },
        {
          status: 'failed',
          error:
            'Отправка прервана перезапуском bridge. Проверьте канал: если поста там нет, согласуйте и опубликуйте снова',
        },
      );

      if (stuck.affected)
        this.logger.warn(
          `${stuck.affected} post(s) were being sent at the last restart`,
        );
    } catch (error) {
      this.logger.warn(`Promo publisher start check failed: ${String(error)}`);
    }
  }

  @Interval(TICK_MS)
  async tick(): Promise<void> {
    if (this.ticking) return;

    this.ticking = true;

    try {
      // Nowhere to send: leave the posts approved rather than failing every one of them each minute.
      if (!(await this.telegram.news())) return;

      const due = await this.posts.find({
        where: {
          channel: 'telegram',
          mode: 'auto',
          status: 'approved',
          scheduledAt: LessThanOrEqual(new Date()),
        },
        order: { scheduledAt: 'ASC' },
      });

      for (const post of due) await this.run(post.id);
    } catch (error) {
      this.logger.warn(`Promo publisher tick failed: ${String(error)}`);
    } finally {
      this.ticking = false;
    }
  }

  // The button: an approved post goes out now, whatever its time.
  async publishNow(id: number): Promise<PromoPost> {
    const post = await this.postsService.get(id);

    if (post.channel !== 'telegram') {
      throw new BadRequestException(
        'Автопубликация есть только в Telegram: остальные каналы выкладываются вручную',
      );
    }

    if (post.status !== 'approved') {
      throw new BadRequestException(
        'Опубликовать можно только согласованный пост: сначала нажмите «Согласовать»',
      );
    }

    if (!(await this.telegram.news())) {
      throw new BadRequestException(
        'Канал новостей не привязан (Промо → Обзор → Telegram)',
      );
    }

    return this.run(id);
  }

  private async run(id: number): Promise<PromoPost> {
    const claimed = await this.posts.update(
      { id, status: 'approved' },
      { status: 'publishing' },
    );

    if (!claimed.affected) return this.postsService.get(id);

    const post = await this.postsService.get(id);

    try {
      const result = await this.telegram.publish(post);

      post.status = 'published';
      post.publishedAt = new Date();
      post.externalUrl = result.url;
      post.error = result.announceError
        ? `Пост вышел, а анонс в группу нет: ${result.announceError}`
        : null;
    } catch (error) {
      post.status = 'failed';
      post.error =
        error instanceof BadRequestException
          ? String(
              (error.getResponse() as { message?: unknown }).message ??
                error.message,
            )
          : error instanceof Error
            ? error.message
            : String(error);
      this.logger.warn(`Promo post ${id} failed: ${post.error}`);
    }

    return this.posts.save(post);
  }
}
