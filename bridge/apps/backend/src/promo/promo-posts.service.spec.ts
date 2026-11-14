import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import type { PromoPost } from './entities/promo-post.entity';
import { PromoPostsService } from './promo-posts.service';

class PostRepo {
  rows: PromoPost[] = [];
  private nextId = 1;

  create(data: Partial<PromoPost>): PromoPost {
    return {
      assetIds: [],
      error: null,
      externalUrl: null,
      publishedAt: null,
      ...data,
    } as PromoPost;
  }

  async save(row: PromoPost): Promise<PromoPost> {
    if (!row.id) {
      row.id = this.nextId++;
      row.createdAt = new Date();
      this.rows.push(row);
    }

    return row;
  }

  async remove(row: PromoPost) {
    this.rows = this.rows.filter((r) => r.id !== row.id);
  }

  async find() {
    return this.rows;
  }

  async findOne(options: { where: { id: number } }) {
    return this.rows.find((r) => r.id === options.where.id) ?? null;
  }
}

describe('PromoPostsService', () => {
  let posts: PostRepo;
  let existingAssets: number[];
  let service: PromoPostsService;

  beforeEach(() => {
    posts = new PostRepo();
    existingAssets = [1, 2];
    service = new PromoPostsService(
      posts as never,
      {
        count: async (options: { where: { id: { _value: number[] } } }) =>
          options.where.id._value.filter((id) => existingAssets.includes(id))
            .length,
      } as never,
    );
  });

  const base = {
    channel: 'telegram' as const,
    title: 'Пост',
    textRu: 'Текст',
    textEn: 'Text',
  };

  it('creates a draft; Telegram posts start automatic, the others as reminders', async () => {
    const tg = await service.create(base);
    const ig = await service.create({ ...base, channel: 'instagram' });

    expect(tg).toMatchObject({ status: 'draft', mode: 'auto', assetIds: [] });
    expect(ig.mode).toBe('reminder');
  });

  it('refuses a missing or doubled asset', async () => {
    await expect(
      service.create({ ...base, assetIds: [1, 99] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create({ ...base, assetIds: [1, 1] })).rejects.toThrow(
      /дважды/,
    );
    await expect(
      service.create({ ...base, assetIds: [1, 2] }),
    ).resolves.toMatchObject({ assetIds: [1, 2] });
  });

  it('approves only a text that fits the channel', async () => {
    const long = await service.create({
      ...base,
      textRu: 'а'.repeat(1200),
      assetIds: [1],
    });

    await expect(service.approve(long.id)).rejects.toThrow(/1024/);
    expect(long.status).toBe('draft');

    // without media the Telegram limit is 4096
    const plain = await service.create({ ...base, textRu: 'а'.repeat(1200) });

    await expect(service.approve(plain.id)).resolves.toMatchObject({
      status: 'approved',
    });
  });

  it('puts an approved post back to a draft when it is edited, so a changed text is never sent unseen', async () => {
    const post = await service.create(base);

    await service.approve(post.id);
    expect(await service.update(post.id, { textRu: 'Другой' })).toMatchObject({
      status: 'draft',
      textRu: 'Другой',
    });
  });

  it('keeps the old fields an update does not mention, and can clear the date', async () => {
    const post = await service.create({
      ...base,
      scheduledAt: '2026-11-20T10:00:00Z',
      utmCampaign: 'p1',
    });
    const updated = await service.update(post.id, { title: ' Новое ' });

    expect(updated).toMatchObject({ title: 'Новое', utmCampaign: 'p1' });
    expect(updated.scheduledAt).toEqual(new Date('2026-11-20T10:00:00Z'));
    expect(
      (await service.update(post.id, { scheduledAt: null })).scheduledAt,
    ).toBeNull();
  });

  it('closes a post as published and then freezes it', async () => {
    const post = await service.create(base);
    const done = await service.markPublished(post.id, 'https://t.me/c/1/2');

    expect(done).toMatchObject({
      status: 'published',
      externalUrl: 'https://t.me/c/1/2',
    });
    expect(done.publishedAt).toBeInstanceOf(Date);
    await expect(
      service.update(post.id, { title: 'x' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(service.approve(post.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('detaches a deleted asset from every post', async () => {
    const a = await service.create({ ...base, assetIds: [1, 2] });
    const b = await service.create({ ...base, assetIds: [2] });
    const c = await service.create(base);

    await service.detachAsset(2);

    expect((await service.get(a.id)).assetIds).toEqual([1]);
    expect((await service.get(b.id)).assetIds).toEqual([]);
    expect((await service.get(c.id)).assetIds).toEqual([]);
  });

  it('reports a missing post', async () => {
    await expect(service.get(404)).rejects.toBeInstanceOf(NotFoundException);
  });
});
