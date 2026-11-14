import { BadRequestException } from '@nestjs/common';

import type { PromoPost } from './entities/promo-post.entity';
import type { PromoTelegramTarget } from './entities/promo-telegram-target.entity';
import { PromoTelegramService } from './promo-telegram.service';

type Call = { method: string; body: Record<string, unknown> | FormData };

// Telegram as the tests want it: answers per method, and every call recorded.
function fakeTelegram(
  answers: Record<string, unknown>,
  failures: Record<string, string> = {},
) {
  const calls: Call[] = [];

  return {
    calls,
    isConfigured: () => true,
    chatId: () => '42',
    request: jest.fn(async (method: string, body: Call['body']) => {
      calls.push({ method, body });

      if (failures[method])
        return { ok: false as const, reason: failures[method] };

      const answer = answers[method];

      return {
        ok: true as const,
        result:
          typeof answer === 'function'
            ? (answer as (b: Call['body']) => unknown)(body)
            : answer,
      };
    }),
  };
}

function setup(
  telegram: ReturnType<typeof fakeTelegram>,
  existing: PromoTelegramTarget[] = [],
  assets: Record<string, unknown>[] = [],
) {
  const rows = [...existing];
  const targets = {
    find: async () => rows,
    findOne: async (o: { where: { role: string } }) =>
      rows.find((r) => r.role === o.where.role) ?? null,
    create: (d: PromoTelegramTarget) => d,
    save: async (d: PromoTelegramTarget) => {
      rows.splice(0, rows.length, ...rows.filter((r) => r.role !== d.role), d);

      return d;
    },
    delete: async (w: { role: string }) => {
      rows.splice(0, rows.length, ...rows.filter((r) => r.role !== w.role));
    },
  };
  const assetRepo = {
    find: async (o: { where: { id: { _value: number[] } } }) =>
      assets.filter((a) => o.where.id._value.includes(a.id as number)),
  };
  const store = { readBytes: async () => Buffer.from('bytes') };
  const chats = { list: async () => [] };
  const service = new PromoTelegramService(
    targets as never,
    assetRepo as never,
    store as never,
    telegram as never,
    chats as never,
  );

  return { service, rows };
}

const post = (over: Partial<PromoPost> = {}): PromoPost =>
  ({
    id: 1,
    channel: 'telegram',
    title: 'Пост',
    textRu: '**Привет**',
    textEn: 'Hello',
    assetIds: [],
    announceInGroup: false,
    ...over,
  }) as PromoPost;
const target = (over: Partial<PromoTelegramTarget> = {}): PromoTelegramTarget =>
  ({
    role: 'news',
    chatId: '-1001234567890',
    title: 'NTLSTL news',
    username: null,
    boundAt: new Date(),
    ...over,
  }) as PromoTelegramTarget;

describe('PromoTelegramService.bind', () => {
  const chan = {
    id: -1001234567890,
    type: 'channel',
    title: 'NTLSTL news',
    username: 'ntlstl_news',
  };
  const admin = { status: 'administrator', can_post_messages: true };

  it('binds a channel the bot administers, after asking Telegram', async () => {
    const tg = fakeTelegram({
      getChat: chan,
      getMe: { id: 99 },
      getChatMember: admin,
    });
    const { service, rows } = setup(tg);

    await expect(service.bind('news', '@ntlstl_news')).resolves.toMatchObject({
      role: 'news',
      chatId: '-1001234567890',
      username: 'ntlstl_news',
    });
    expect(rows).toHaveLength(1);
    expect(tg.calls.find((c) => c.method === 'getChat')?.body).toEqual({
      chat_id: '@ntlstl_news',
    });
    expect(tg.calls.find((c) => c.method === 'getChatMember')?.body).toEqual({
      chat_id: -1001234567890,
      user_id: 99,
    });
  });

  it('refuses what is not a chat reference, without calling Telegram', async () => {
    const tg = fakeTelegram({});
    const { service } = setup(tg);

    await expect(
      service.bind('news', 'https://t.me/+oJq2JlgIkIRmMWQy'),
    ).rejects.toThrow(/числовой id/);
    expect(tg.calls).toEqual([]);
  });

  it('passes on the reason Telegram gives when the chat is unknown', async () => {
    const { service } = setup(
      fakeTelegram({}, { getChat: 'Bad Request: chat not found' }),
    );

    await expect(service.bind('news', '@nobody_here')).rejects.toThrow(
      /chat not found/,
    );
  });

  it('wants a channel for the news and a group for the discussion', async () => {
    const group = { id: -100222, type: 'supergroup', title: 'NTLSTL' };
    const { service } = setup(
      fakeTelegram({
        getChat: (b: Call['body']) =>
          (b as { chat_id: string }).chat_id === '-100222' ? group : chan,
        getMe: { id: 99 },
        getChatMember: admin,
      }),
    );

    await expect(service.bind('news', '-100222')).rejects.toThrow(/не канал/);
    await expect(service.bind('discussion', '@ntlstl_news')).rejects.toThrow(
      /не группа/,
    );
    await expect(service.bind('discussion', '-100222')).resolves.toMatchObject({
      role: 'discussion',
      title: 'NTLSTL',
    });
  });

  it('wants the bot to be able to post in the channel', async () => {
    const member = { id: 99 };

    await expect(
      setup(
        fakeTelegram({
          getChat: chan,
          getMe: member,
          getChatMember: { status: 'member' },
        }),
      ).service.bind('news', '@ntlstl_news'),
    ).rejects.toThrow(/администратором/);
    await expect(
      setup(
        fakeTelegram({
          getChat: chan,
          getMe: member,
          getChatMember: { status: 'administrator', can_post_messages: false },
        }),
      ).service.bind('news', '@ntlstl_news'),
    ).rejects.toThrow(/администратором/);
  });

  it('wants the bot to be in the group', async () => {
    const group = { id: -100222, type: 'group', title: 'G' };

    await expect(
      setup(
        fakeTelegram({
          getChat: group,
          getMe: { id: 99 },
          getChatMember: { status: 'left' },
        }),
      ).service.bind('discussion', '-100222'),
    ).rejects.toThrow(/Бота нет в группе/);
    await expect(
      setup(
        fakeTelegram({
          getChat: group,
          getMe: { id: 99 },
          getChatMember: { status: 'member' },
        }),
      ).service.bind('discussion', '-100222'),
    ).resolves.toBeTruthy();
  });

  it('replaces an earlier binding of the same role, and unbinds', async () => {
    const tg = fakeTelegram({
      getChat: chan,
      getMe: { id: 99 },
      getChatMember: admin,
    });
    const { service, rows } = setup(tg, [target({ chatId: '-100old' })]);

    await service.bind('news', '@ntlstl_news');
    expect(rows.map((r) => r.chatId)).toEqual(['-1001234567890']);

    await service.unbind('news');
    expect(rows).toEqual([]);
  });
});

describe('PromoTelegramService.publish', () => {
  it('sends a text post to the channel as HTML and returns the link', async () => {
    const tg = fakeTelegram({ sendMessage: { message_id: 7 } });
    const { service } = setup(tg, [target({ username: 'ntlstl_news' })]);

    const result = await service.publish(post());

    expect(result).toEqual({
      messageId: 7,
      url: 'https://t.me/ntlstl_news/7',
      announceError: null,
    });
    expect(tg.calls[0]).toEqual({
      method: 'sendMessage',
      body: {
        chat_id: '-1001234567890',
        text: '<b>Привет</b>\n\nHello',
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      },
    });
  });

  it('refuses without a bound channel', async () => {
    const { service } = setup(fakeTelegram({}));

    await expect(service.publish(post())).rejects.toThrow(/не привязан/);
  });

  it('uploads one file with the text as its caption', async () => {
    const tg = fakeTelegram({ sendVideo: { message_id: 8 } });
    const { service } = setup(
      tg,
      [target()],
      [
        {
          id: 5,
          originalName: 'N4.mp4',
          mime: 'video/mp4',
          size: 1000,
          storedName: 'x.mp4',
        },
      ],
    );

    const result = await service.publish(post({ assetIds: [5] }));
    const form = tg.calls[0].body as FormData;

    expect(tg.calls[0].method).toBe('sendVideo');
    expect(result.url).toBe('https://t.me/c/1234567890/8');
    expect(form.get('chat_id')).toBe('-1001234567890');
    expect(form.get('caption')).toBe('<b>Привет</b>\n\nHello');
    expect(form.get('parse_mode')).toBe('HTML');
    expect((form.get('video') as File).name).toBe('N4.mp4');
  });

  it('sends several files as an album with the caption on the first', async () => {
    const tg = fakeTelegram({
      sendMediaGroup: [{ message_id: 20 }, { message_id: 21 }],
    });
    const assets = [
      {
        id: 1,
        originalName: 'a.jpg',
        mime: 'image/jpeg',
        size: 10,
        storedName: 'a.jpg',
      },
      {
        id: 2,
        originalName: 'b.mp4',
        mime: 'video/mp4',
        size: 10,
        storedName: 'b.mp4',
      },
    ];
    const { service } = setup(tg, [target()], assets);

    const result = await service.publish(post({ assetIds: [2, 1] }));
    const media = JSON.parse(
      (tg.calls[0].body as FormData).get('media') as string,
    );

    expect(result.messageId).toBe(20);
    // the order of the post, not of the database
    expect(media.map((m: { type: string }) => m.type)).toEqual([
      'video',
      'photo',
    ]);
    expect(media[0]).toMatchObject({
      media: 'attach://file0',
      caption: '<b>Привет</b>\n\nHello',
      parse_mode: 'HTML',
    });
    expect(media[1].caption).toBeUndefined();
  });

  it('refuses a missing or an oversized file before sending anything', async () => {
    const tg = fakeTelegram({});
    const { service } = setup(
      tg,
      [target()],
      [
        {
          id: 5,
          originalName: 'big.mp4',
          mime: 'video/mp4',
          size: 60 * 1024 * 1024,
          storedName: 'x',
        },
      ],
    );

    await expect(service.publish(post({ assetIds: [9] }))).rejects.toThrow(
      /уже нет/,
    );
    await expect(service.publish(post({ assetIds: [5] }))).rejects.toThrow(
      /больше 50 МБ/,
    );
    expect(tg.calls).toEqual([]);
  });

  it("says Telegram's own reason when it refuses", async () => {
    const { service } = setup(
      fakeTelegram(
        {},
        { sendMessage: 'Forbidden: bot is not a member of the channel chat' },
      ),
      [target()],
    );

    await expect(service.publish(post())).rejects.toThrow(
      /bot is not a member/,
    );
    await expect(service.publish(post())).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('announces the post in the group with a button, and survives a failed announcement', async () => {
    const tg = fakeTelegram({ sendMessage: { message_id: 9 } });
    const rows = [
      target({ username: 'ntlstl_news' }),
      target({
        role: 'discussion',
        chatId: '-100222',
        title: 'NTLSTL',
        username: null,
      }),
    ];
    const { service } = setup(tg, rows);

    expect(
      await service.publish(post({ announceInGroup: true })),
    ).toMatchObject({ announceError: null });
    expect(tg.calls[1].body).toMatchObject({
      chat_id: '-100222',
      text: 'Новый пост в канале: «Пост»',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Открыть пост', url: 'https://t.me/ntlstl_news/9' }],
        ],
      },
    });

    const noGroup = setup(fakeTelegram({ sendMessage: { message_id: 9 } }), [
      target(),
    ]);

    expect(
      (await noGroup.service.publish(post({ announceInGroup: true })))
        .announceError,
    ).toMatch(/не привязана/);

    const failing = setup(
      fakeTelegram(
        {
          sendMessage: (b: Call['body']) =>
            (b as { chat_id: string }).chat_id === '-100222'
              ? undefined
              : { message_id: 9 },
        },
        {},
      ),
      rows,
    );

    expect((await failing.service.publish(post())).announceError).toBeNull();
  });
});

describe('PromoTelegramService.sendTest', () => {
  it("sends to the owner's own chat and never to the channel", async () => {
    const tg = fakeTelegram({ sendMessage: { message_id: 1 } });
    const { service } = setup(tg, [target()]);

    await service.sendTest(post());

    expect(tg.calls).toHaveLength(1);
    expect(tg.calls[0].body).toMatchObject({ chat_id: '42' });
  });
});
