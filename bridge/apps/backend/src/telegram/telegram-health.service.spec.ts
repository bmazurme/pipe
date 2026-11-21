import {
  formatDuration,
  TelegramHealthService,
} from './telegram-health.service';

const START = new Date('2026-11-21T09:00:00Z').getTime();

function setup(options: { configured?: boolean; fallback?: boolean } = {}) {
  let failingSince: Date | null = null;
  let error: string | null = null;
  let lastAttempt: Date | null = new Date(START);
  const telegram = {
    isConfigured: jest.fn(() => options.configured ?? true),
    health: jest.fn((now: number) => ({
      down: failingSince !== null && now - failingSince.getTime() >= 180_000,
      failingSince,
      lastError: error,
      lastOkAt: null,
      lastAttemptAt: lastAttempt,
    })),
    api: jest.fn(async () => null),
    send: jest.fn(async () => true),
  };
  const fallback = {
    isConfigured: jest.fn(() => options.fallback ?? true),
    send: jest.fn(async () => true),
  };
  const record = jest.fn(async () => undefined);
  const service = new TelegramHealthService(
    telegram as never,
    fallback as never,
    { record } as never,
  );

  return {
    service,
    telegram,
    fallback,
    record,
    fail: (since: number, why = 'timeout') => {
      failingSince = new Date(since);
      error = why;
    },
    recover: () => {
      failingSince = null;
      error = null;
    },
    attempted: (at: number | null) => {
      lastAttempt = at === null ? null : new Date(at);
    },
  };
}

describe('TelegramHealthService', () => {
  it('says nothing while Telegram works', async () => {
    const { service, fallback } = setup();

    await service.check(START + 60_000);

    expect(fallback.send).not.toHaveBeenCalled();
  });

  it('waits out a short failure, then announces the outage once through the other channel', async () => {
    const { service, fallback, fail, record } = setup();

    fail(START, 'The operation was aborted due to timeout');
    await service.check(START + 120_000);
    expect(fallback.send).not.toHaveBeenCalled();

    await service.check(START + 190_000);
    await service.check(START + 220_000);

    expect(fallback.send).toHaveBeenCalledTimes(1);
    const text = (fallback.send.mock.calls[0] as unknown as [string])[0];

    expect(text).toContain('🔴 Telegram недоступен с');
    expect(text).toContain('aborted due to timeout');
    expect(text).toContain('Срочные уведомления приходят сюда');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'telegram.down', level: 'error' }),
    );
  });

  it('reminds once an hour while it stays down', async () => {
    const { service, fallback, fail } = setup();

    fail(START);
    await service.check(START + 200_000);
    await service.check(START + 30 * 60_000);
    expect(fallback.send).toHaveBeenCalledTimes(1);

    await service.check(START + 64 * 60_000);
    expect(fallback.send).toHaveBeenCalledTimes(2);
    expect((fallback.send.mock.calls[1] as unknown as [string])[0]).toContain(
      'всё ещё',
    );
  });

  it('says it is back, in Telegram and in the other channel, with how long it was out', async () => {
    const { service, fallback, telegram, fail, recover, record } = setup();

    fail(START);
    await service.check(START + 200_000);
    recover();
    await service.check(START + 12 * 60_000);
    await service.check(START + 13 * 60_000);

    expect(telegram.send).toHaveBeenCalledTimes(1);
    expect(fallback.send).toHaveBeenCalledTimes(2);
    expect((telegram.send.mock.calls[0] as unknown as [string])[0]).toMatch(
      /✅ Telegram снова доступен \(не работал 12 мин/,
    );
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'telegram.up' }),
    );
  });

  it('still records the outage when no other channel is set up (and says nobody could be told)', async () => {
    const { service, fallback, fail, record } = setup({ fallback: false });

    fail(START);
    await service.check(START + 200_000);

    expect(fallback.send).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'telegram.down',
        meta: { fallbackConfigured: false, delivered: false },
      }),
    );
  });

  it('asks Telegram itself when nothing has called it for a while, and not when something just did', async () => {
    const quiet = setup();

    quiet.attempted(START - 200_000);
    await quiet.service.check(START);
    expect(quiet.telegram.api).toHaveBeenCalledWith('getMe', {}, 8_000);

    const busy = setup();

    busy.attempted(START - 10_000);
    await busy.service.check(START);
    expect(busy.telegram.api).not.toHaveBeenCalled();
  });

  it('does nothing when the bot is not set up at all', async () => {
    const { service, telegram } = setup({ configured: false });

    await service.check(START);

    expect(telegram.health).not.toHaveBeenCalled();
  });
});

describe('formatDuration', () => {
  it('reads as minutes, then hours', () => {
    expect(formatDuration(30_000)).toBe('1 мин');
    expect(formatDuration(12 * 60_000)).toBe('12 мин');
    expect(formatDuration(135 * 60_000)).toBe('2 ч 15 мин');
  });
});
