import { TelegramChatsService } from './telegram-chats.service';
import { chatFromUpdate } from './telegram-chats';

describe('chatFromUpdate', () => {
  it('reads the chat and the bot status from my_chat_member', () => {
    expect(
      chatFromUpdate({
        my_chat_member: {
          chat: { id: -1001, type: 'channel', title: 'News', username: 'news' },
          new_chat_member: { status: 'administrator' },
        },
      }),
    ).toEqual({
      chatId: '-1001',
      type: 'channel',
      title: 'News',
      username: 'news',
      botStatus: 'administrator',
    });
  });

  it('reads a channel post and a group message without a status', () => {
    expect(
      chatFromUpdate({
        channel_post: { chat: { id: -1001, type: 'channel', title: 'N' } },
      }),
    ).toMatchObject({ type: 'channel', botStatus: null });
    expect(
      chatFromUpdate({
        message: { chat: { id: -1002, type: 'supergroup', title: 'G' } },
      }),
    ).toMatchObject({ chatId: '-1002', type: 'supergroup' });
  });

  it('ignores private chats and updates with no chat', () => {
    expect(
      chatFromUpdate({ message: { chat: { id: 42, type: 'private' } } }),
    ).toBeNull();
    expect(chatFromUpdate({})).toBeNull();
  });
});

describe('TelegramChatsService.observe', () => {
  function make() {
    const rows = new Map<string, Record<string, unknown>>();
    const repo = {
      findOne: async (o: { where: { chatId: string } }) =>
        rows.get(o.where.chatId) ?? null,
      create: (d: Record<string, unknown>) => d,
      save: jest.fn(async (d: Record<string, unknown>) => {
        rows.set(d.chatId as string, d);

        return d;
      }),
    };

    return { service: new TelegramChatsService(repo as never), repo, rows };
  }

  const added = {
    my_chat_member: {
      chat: { id: -1001, type: 'channel', title: 'News' },
      new_chat_member: { status: 'administrator' },
    },
  };
  const post = { channel_post: { chat: { id: -1001, type: 'channel' } } };

  it('records a chat and keeps what it knew when a later update says less', async () => {
    const { service, rows } = make();

    await service.observe(added);
    await service.observe({
      my_chat_member: {
        chat: { id: -1001, type: 'channel' },
        new_chat_member: { status: 'administrator' },
      },
    });

    expect(rows.get('-1001')).toMatchObject({
      title: 'News',
      botStatus: 'administrator',
    });
  });

  it('does not write for every message of a busy chat, but always for a change of the bot status', async () => {
    const { service, repo } = make();

    await service.observe(added);
    await service.observe(post);
    await service.observe(post);
    expect(repo.save).toHaveBeenCalledTimes(1);

    await service.observe({
      my_chat_member: {
        chat: { id: -1001, type: 'channel' },
        new_chat_member: { status: 'left' },
      },
    });
    expect(repo.save).toHaveBeenCalledTimes(2);
  });

  it('never throws', async () => {
    const service = new TelegramChatsService({
      findOne: async () => {
        throw new Error('db down');
      },
    } as never);

    await expect(service.observe(added)).resolves.toBeUndefined();
  });
});
