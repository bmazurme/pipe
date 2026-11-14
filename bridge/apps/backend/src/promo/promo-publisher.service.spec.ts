import { BadRequestException } from '@nestjs/common';

import type { PromoPost } from './entities/promo-post.entity';
import { PromoPublisherService } from './promo-publisher.service';

const HOUR = 3_600_000;

// Rows in memory, with the conditional update the claim relies on.
class PostRepo {
  rows: PromoPost[] = [];

  async find(o: {
    where: Partial<PromoPost> & { scheduledAt?: { _value: Date } };
  }) {
    return this.rows
      .filter(
        (r) =>
          r.channel === o.where.channel &&
          r.mode === o.where.mode &&
          r.status === o.where.status,
      )
      .filter(
        (r) =>
          r.scheduledAt &&
          r.scheduledAt.getTime() <= o.where.scheduledAt!._value.getTime(),
      )
      .sort((a, b) => a.scheduledAt!.getTime() - b.scheduledAt!.getTime());
  }

  async update(
    where: { id?: number; status: string },
    set: Partial<PromoPost>,
  ) {
    const hit = this.rows.filter(
      (r) =>
        (where.id === undefined || r.id === where.id) &&
        r.status === where.status,
    );

    for (const row of hit) Object.assign(row, set);

    return { affected: hit.length };
  }

  async save(row: PromoPost) {
    return row;
  }
}

const post = (id: number, over: Partial<PromoPost> = {}): PromoPost =>
  ({
    id,
    channel: 'telegram',
    mode: 'auto',
    status: 'approved',
    scheduledAt: new Date(Date.now() - HOUR),
    error: null,
    externalUrl: null,
    publishedAt: null,
    ...over,
  }) as PromoPost;

function setup(
  rows: PromoPost[],
  telegram: { news?: unknown; publish?: jest.Mock } = {},
) {
  const repo = new PostRepo();

  repo.rows = rows;

  const tg = {
    news: jest.fn(async () =>
      'news' in telegram ? telegram.news : { chatId: '-100' },
    ),
    publish:
      telegram.publish ??
      jest.fn(async () => ({
        messageId: 1,
        url: 'https://t.me/x/1',
        announceError: null,
      })),
  };
  const posts = {
    get: async (id: number) => repo.rows.find((r) => r.id === id)!,
  };
  const service = new PromoPublisherService(
    repo as never,
    posts as never,
    tg as never,
  );

  return { service, repo, tg };
}

describe('PromoPublisherService.tick', () => {
  it('sends the approved automatic Telegram posts whose time has come, soonest first, and marks them published', async () => {
    const { service, repo, tg } = setup([
      post(1, { scheduledAt: new Date(Date.now() - HOUR) }),
      post(2, { scheduledAt: new Date(Date.now() - 2 * HOUR) }),
    ]);

    await service.tick();

    expect(tg.publish.mock.calls.map(([p]) => p.id)).toEqual([2, 1]);
    expect(repo.rows.map((r) => r.status)).toEqual(['published', 'published']);
    expect(repo.rows[0]).toMatchObject({
      externalUrl: 'https://t.me/x/1',
      error: null,
    });
    expect(repo.rows[0].publishedAt).toBeInstanceOf(Date);
  });

  it('leaves alone what is not due: a draft, a future time, a reminder, another channel, no time', async () => {
    const { service, repo, tg } = setup([
      post(1, { status: 'draft' }),
      post(2, { scheduledAt: new Date(Date.now() + HOUR) }),
      post(3, { mode: 'reminder' }),
      post(4, { channel: 'youtube' }),
      post(5, { scheduledAt: null }),
    ]);

    await service.tick();

    expect(tg.publish).not.toHaveBeenCalled();
    expect(repo.rows.map((r) => r.status)).toEqual([
      'draft',
      'approved',
      'approved',
      'approved',
      'approved',
    ]);
  });

  it('does nothing without a bound channel, so posts stay approved instead of failing every minute', async () => {
    const { service, repo, tg } = setup([post(1)], { news: null });

    await service.tick();

    expect(tg.publish).not.toHaveBeenCalled();
    expect(repo.rows[0].status).toBe('approved');
  });

  it("marks a post failed with Telegram's reason, and goes on to the next", async () => {
    const publish = jest
      .fn()
      .mockRejectedValueOnce(
        new BadRequestException('Telegram: Forbidden: bot was kicked'),
      )
      .mockResolvedValue({ messageId: 2, url: null, announceError: null });
    const { service, repo } = setup(
      [post(1, { scheduledAt: new Date(Date.now() - 2 * HOUR) }), post(2)],
      { publish },
    );

    await service.tick();

    expect(repo.rows[0]).toMatchObject({
      status: 'failed',
      error: 'Telegram: Forbidden: bot was kicked',
    });
    expect(repo.rows[1].status).toBe('published');
  });

  it('keeps a note when the post is out but the announcement in the group is not', async () => {
    const { service, repo } = setup([post(1)], {
      publish: jest.fn(async () => ({
        messageId: 3,
        url: 'u',
        announceError: 'группа обсуждений не привязана',
      })),
    });

    await service.tick();

    expect(repo.rows[0].status).toBe('published');
    expect(repo.rows[0].error).toMatch(
      /анонс в группу нет: группа обсуждений не привязана/,
    );
  });

  it('does not run two ticks at once', async () => {
    let release: () => void = () => undefined;
    const publish = jest.fn(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({ messageId: 1, url: null, announceError: null });
        }),
    );
    const { service } = setup([post(1)], { publish });

    const first = service.tick();

    await new Promise((resolve) => setImmediate(resolve));
    await service.tick();
    release();
    await first;

    expect(publish).toHaveBeenCalledTimes(1);
  });
});

describe('PromoPublisherService.publishNow', () => {
  it('sends an approved post at once', async () => {
    const { service, tg } = setup([
      post(1, { scheduledAt: new Date(Date.now() + HOUR) }),
    ]);

    await expect(service.publishNow(1)).resolves.toMatchObject({
      status: 'published',
    });
    expect(tg.publish).toHaveBeenCalledTimes(1);
  });

  it('is refused for a draft, another channel, or without a channel bound', async () => {
    await expect(
      setup([post(1, { status: 'draft' })]).service.publishNow(1),
    ).rejects.toThrow(/сначала нажмите «Согласовать»/);
    await expect(
      setup([post(1, { channel: 'instagram' })]).service.publishNow(1),
    ).rejects.toThrow(/только в Telegram/);
    await expect(
      setup([post(1)], { news: null }).service.publishNow(1),
    ).rejects.toThrow(/не привязан/);
  });

  it('cannot send a post twice: the second claim finds it already taken', async () => {
    const { service, tg } = setup([post(1)]);

    await Promise.all(
      [service.publishNow(1), service.publishNow(1)].map((p) =>
        p.catch(() => undefined),
      ),
    );

    expect(tg.publish).toHaveBeenCalledTimes(1);
  });
});

describe('PromoPublisherService at start', () => {
  it('never sends again a post that was being sent at a restart: it is marked failed for the owner to check', async () => {
    const { service, repo, tg } = setup([
      post(1, { status: 'publishing' }),
      post(2, { status: 'approved' }),
    ]);

    await service.onModuleInit();

    expect(repo.rows[0]).toMatchObject({ status: 'failed' });
    expect(repo.rows[0].error).toMatch(/Проверьте канал/);
    expect(repo.rows[1].status).toBe('approved');
    expect(tg.publish).not.toHaveBeenCalled();
  });
});
