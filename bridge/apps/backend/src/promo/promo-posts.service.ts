import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { CreatePromoPostDto, UpdatePromoPostDto } from './dto/promo-post.dto';
import { PromoAsset } from './entities/promo-asset.entity';
import { PromoPost } from './entities/promo-post.entity';
import {
  captionProblem,
  type PromoChannel,
  type PromoPostStatus,
} from './promo-limits';

// A post that has gone out (or was handed to the owner as a reminder) is a record, not a draft any more.
const FROZEN: PromoPostStatus[] = ['published', 'reminded'];

@Injectable()
export class PromoPostsService {
  constructor(
    @InjectRepository(PromoPost)
    private readonly posts: Repository<PromoPost>,
    @InjectRepository(PromoAsset)
    private readonly assets: Repository<PromoAsset>,
  ) {}

  list(
    filter: { channel?: PromoChannel; status?: PromoPostStatus } = {},
  ): Promise<PromoPost[]> {
    return this.posts.find({
      where: {
        ...(filter.channel ? { channel: filter.channel } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      // The coming ones first (soonest on top), the unscheduled after them, newest first.
      order: { scheduledAt: { direction: 'ASC', nulls: 'LAST' }, id: 'DESC' },
    });
  }

  async get(id: number): Promise<PromoPost> {
    const post = await this.posts.findOne({ where: { id } });

    if (!post) throw new NotFoundException('Пост не найден');

    return post;
  }

  async create(dto: CreatePromoPostDto): Promise<PromoPost> {
    const assetIds = dto.assetIds ?? [];

    await this.assertAssets(assetIds);

    return this.posts.save(
      this.posts.create({
        channel: dto.channel,
        title: dto.title.trim(),
        textRu: dto.textRu ?? '',
        textEn: dto.textEn ?? '',
        assetIds,
        // Only Telegram has an automatic publisher so far; the others start as a reminder.
        mode: dto.mode ?? (dto.channel === 'telegram' ? 'auto' : 'reminder'),
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        utmCampaign: dto.utmCampaign ?? null,
        status: 'draft',
      }),
    );
  }

  async update(id: number, dto: UpdatePromoPostDto): Promise<PromoPost> {
    const post = await this.get(id);

    this.assertEditable(post);

    if (dto.assetIds) await this.assertAssets(dto.assetIds);

    if (dto.title !== undefined) post.title = dto.title.trim();
    if (dto.textRu !== undefined) post.textRu = dto.textRu;
    if (dto.textEn !== undefined) post.textEn = dto.textEn;
    if (dto.assetIds !== undefined) post.assetIds = dto.assetIds;
    if (dto.mode !== undefined) post.mode = dto.mode;
    if (dto.scheduledAt !== undefined) {
      post.scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
    }
    if (dto.utmCampaign !== undefined) post.utmCampaign = dto.utmCampaign;

    // What was approved is not what is on the screen any more: back to a draft, so a changed text is never sent unseen.
    if (post.status === 'approved' || post.status === 'failed') {
      post.status = 'draft';
      post.error = null;
    }

    return this.posts.save(post);
  }

  async remove(id: number): Promise<void> {
    const post = await this.get(id);

    await this.posts.remove(post);
  }

  // draft/failed → approved: the text is checked against the channel's limit here, not at the moment of sending.
  async approve(id: number): Promise<PromoPost> {
    const post = await this.get(id);

    this.assertEditable(post);

    const problem = captionProblem(
      post.channel,
      post.title,
      post.textRu,
      post.textEn,
      post.assetIds.length > 0,
    );

    if (problem) throw new BadRequestException(problem);

    post.status = 'approved';
    post.error = null;

    return this.posts.save(post);
  }

  async unapprove(id: number): Promise<PromoPost> {
    const post = await this.get(id);

    this.assertEditable(post);
    post.status = 'draft';

    return this.posts.save(post);
  }

  // The owner posted it by hand (a reminder), or wants the record closed: published now, with the link when there is one.
  async markPublished(id: number, externalUrl?: string): Promise<PromoPost> {
    const post = await this.get(id);

    post.status = 'published';
    post.publishedAt = post.publishedAt ?? new Date();
    post.error = null;

    if (externalUrl) post.externalUrl = externalUrl;

    return this.posts.save(post);
  }

  // Drops an asset from every post that carries it (called when the asset is deleted).
  async detachAsset(assetId: number): Promise<void> {
    const carrying = (await this.posts.find()).filter((post) =>
      post.assetIds.includes(assetId),
    );

    for (const post of carrying) {
      post.assetIds = post.assetIds.filter((id) => id !== assetId);
      await this.posts.save(post);
    }
  }

  private assertEditable(post: PromoPost): void {
    if (FROZEN.includes(post.status)) {
      throw new ConflictException(
        'Пост уже опубликован: его нельзя менять (создайте новый)',
      );
    }
  }

  private async assertAssets(ids: number[]): Promise<void> {
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Файл прикреплён к посту дважды');
    }

    if (ids.length === 0) return;

    const found = await this.assets.count({ where: { id: In(ids) } });

    if (found !== ids.length) {
      throw new BadRequestException('Какого-то из файлов поста нет');
    }
  }
}
