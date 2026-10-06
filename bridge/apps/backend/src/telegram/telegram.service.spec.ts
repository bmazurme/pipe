import { ConfigService } from '@nestjs/config';

import { TelegramService } from './telegram.service';

function make(values: Record<string, string>) {
  return new TelegramService({
    get: (key: string) => values[key],
  } as unknown as ConfigService);
}

function telegramOk(result: unknown): Response {
  return {
    ok: true,
    json: async () => ({ ok: true, result }),
  } as Response;
}

describe('TelegramService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('is a no-op when unconfigured', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');

    await expect(make({}).send('hi')).resolves.toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts to the bot API with the owner chat id', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(telegramOk({ message_id: 1 }));
    const service = make({ TELEGRAM_BOT_TOKEN: 'T', TELEGRAM_CHAT_ID: '42' });

    await expect(service.send('hello')).resolves.toBe(true);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/botT/sendMessage');
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      chat_id: '42',
      text: 'hello',
    });
  });

  it('swallows network errors and non-2xx responses', async () => {
    const service = make({ TELEGRAM_BOT_TOKEN: 'T', TELEGRAM_CHAT_ID: '42' });

    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('down'));
    await expect(service.send('x')).resolves.toBe(false);

    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    await expect(service.send('x')).resolves.toBe(false);
  });

  it('returns the result field from api()', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(telegramOk([{ update_id: 1 }]));
    const service = make({ TELEGRAM_BOT_TOKEN: 'T' });

    await expect(service.api('getUpdates', {})).resolves.toEqual([
      { update_id: 1 },
    ]);
  });

  it('treats ok:false as a failure', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, description: 'Conflict' }),
    } as Response);
    const service = make({ TELEGRAM_BOT_TOKEN: 'T' });

    await expect(service.api('getUpdates', {})).resolves.toBeNull();
  });

  it('routes through the proxy only when TELEGRAM_PROXY_URL is set', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(telegramOk(true));

    await make({ TELEGRAM_BOT_TOKEN: 'T' }).api('getMe', {});
    expect(
      (fetchSpy.mock.calls[0][1] as { dispatcher?: unknown }).dispatcher,
    ).toBeUndefined();

    await make({
      TELEGRAM_BOT_TOKEN: 'T',
      TELEGRAM_PROXY_URL: 'http://vpn-client:1080',
    }).api('getMe', {});
    expect(
      (fetchSpy.mock.calls[1][1] as { dispatcher?: unknown }).dispatcher,
    ).toBeDefined();
  });

  it('sends an inline keyboard with the message', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(telegramOk({}));
    const service = make({ TELEGRAM_BOT_TOKEN: 'T', TELEGRAM_CHAT_ID: '42' });

    await service.sendWithButtons('merge?', [
      [{ text: 'Go', callback_data: 'merge:1:abc1234' }],
    ]);

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );

    expect(body.reply_markup).toEqual({
      inline_keyboard: [[{ text: 'Go', callback_data: 'merge:1:abc1234' }]],
    });
    expect(body.chat_id).toBe('42');
  });

  it('answers a callback query', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(telegramOk(true));

    await make({ TELEGRAM_BOT_TOKEN: 'T' }).answerCallback('cb1', 'ok');

    expect(fetchSpy.mock.calls[0][0]).toContain('/answerCallbackQuery');
    expect(
      JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string),
    ).toEqual({
      callback_query_id: 'cb1',
      text: 'ok',
    });
  });
});
