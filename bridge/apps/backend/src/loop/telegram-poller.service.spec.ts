import { ConfigService } from '@nestjs/config';

import { TelegramPollerService } from './telegram-poller.service';

function setup(apiResult: unknown) {
  const telegram = {
    api: jest.fn().mockResolvedValue(apiResult),
    isConfigured: jest.fn().mockReturnValue(true),
  };
  const commands = { handle: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn() } as unknown as ConfigService;
  const poller = new TelegramPollerService(
    telegram as never,
    commands as never,
    config,
  );

  return { poller, telegram, commands, config };
}

describe('TelegramPollerService.pollOnce', () => {
  it('handles each update and advances the offset past the last one', async () => {
    const { poller, telegram, commands } = setup([
      { update_id: 10, message: { text: '/status' } },
      { update_id: 11, message: { text: '/help' } },
    ]);

    await expect(poller.pollOnce()).resolves.toBe(2);
    expect(commands.handle).toHaveBeenCalledTimes(2);

    await poller.pollOnce();
    expect(telegram.api).toHaveBeenLastCalledWith(
      'getUpdates',
      expect.objectContaining({ offset: 12 }),
      expect.any(Number),
    );
  });

  it('reports a failed call as null so the loop backs off', async () => {
    await expect(setup(null).poller.pollOnce()).resolves.toBeNull();
  });

  it('keeps going and still advances the offset when a command throws', async () => {
    const { poller, commands } = setup([{ update_id: 5 }, { update_id: 6 }]);
    commands.handle.mockRejectedValueOnce(new Error('boom'));

    await expect(poller.pollOnce()).resolves.toBe(2);
    expect(commands.handle).toHaveBeenCalledTimes(2);
  });
});

describe('TelegramPollerService.onApplicationBootstrap', () => {
  it('stays off unless TELEGRAM_POLLING=true', () => {
    const { poller, telegram, config } = setup([]);
    (config.get as jest.Mock).mockReturnValue(undefined);

    poller.onApplicationBootstrap();

    expect(telegram.api).not.toHaveBeenCalled();
  });
});
