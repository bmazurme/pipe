import { ConfigService } from '@nestjs/config';

import { TelegramService } from './telegram.service';

function make(values: Record<string, string>) {
  return new TelegramService({
    get: (key: string) => values[key],
  } as unknown as ConfigService);
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
      .mockResolvedValue({ ok: true } as Response);
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
});
