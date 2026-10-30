import { NotificationSettingsService } from './notification-settings.service';
import { NotifyService } from './notify.service';

const MSK_NIGHT = new Date('2026-10-07T22:30:00Z'); // 01:30 Moscow
const MSK_DAY = new Date('2026-10-08T09:00:00Z'); // 12:00 Moscow

function setup(config: Record<string, string> = {}, now = MSK_NIGHT) {
  jest.useFakeTimers().setSystemTime(now);

  const telegram = {
    isConfigured: jest.fn().mockReturnValue(true),
    send: jest.fn().mockResolvedValue(true),
    sendWithButtons: jest.fn().mockResolvedValue(true),
  };
  const rows: Array<{
    id: number;
    text: string;
    buttons: string | null;
    createdAt: Date;
  }> = [];
  let nextId = 1;
  const outbox = {
    save: jest.fn(async (row: { text: string; buttons: string | null }) => {
      rows.push({ id: nextId++, createdAt: new Date(), ...row });
    }),
    find: jest.fn(async () => [...rows]),
    delete: jest.fn(async (ids: number | number[]) => {
      for (const id of [ids].flat()) {
        rows.splice(
          rows.findIndex((row) => row.id === id),
          1,
        );
      }
    }),
  };
  const settings = new NotificationSettingsService(
    { findOne: jest.fn().mockResolvedValue(null) } as never,
    { get: (key: string) => config[key] } as never,
  );
  const service = new NotifyService(
    telegram as never,
    settings as never,
    outbox as never,
  );

  return { service, telegram, outbox, rows };
}

describe('NotifyService', () => {
  afterEach(() => jest.useRealTimers());

  it('sends immediately outside quiet hours', async () => {
    const { service, telegram, outbox } = setup({}, MSK_DAY);

    await service.send('hello');

    expect(telegram.send).toHaveBeenCalledWith('hello');
    expect(outbox.save).not.toHaveBeenCalled();
  });

  it('queues instead of sending during quiet hours', async () => {
    const { service, telegram, rows } = setup();

    await expect(service.send('night event')).resolves.toBe(true);

    expect(telegram.send).not.toHaveBeenCalled();
    expect(rows.map((row) => row.text)).toEqual(['night event']);
  });

  it('does not queue when Telegram is not configured', async () => {
    const { service, telegram, rows } = setup();
    telegram.isConfigured.mockReturnValue(false);

    await expect(service.send('x')).resolves.toBe(false);
    expect(rows).toHaveLength(0);
  });

  it('can be switched off', async () => {
    const { service, telegram } = setup({ NOTIFY_QUIET_HOURS: 'off' });

    await service.send('now');

    expect(telegram.send).toHaveBeenCalledWith('now');
  });

  it('keeps button messages queued with their keyboard', async () => {
    const { service, telegram, rows } = setup();
    const buttons = [[{ text: 'Merge', callback_data: 'merge:1:abc' }]];

    await service.sendWithButtons('PR ready', buttons);

    expect(telegram.sendWithButtons).not.toHaveBeenCalled();
    expect(JSON.parse(rows[0].buttons as string)).toEqual(buttons);
  });

  describe('flush', () => {
    it('does nothing while it is still quiet', async () => {
      const { service, telegram, outbox } = setup();

      await service.flush();

      expect(outbox.find).not.toHaveBeenCalled();
      expect(telegram.send).not.toHaveBeenCalled();
    });

    it('sends one digest in the morning and empties the queue', async () => {
      const { service, telegram, rows } = setup();
      await service.send('first');
      await service.send('second');

      jest.setSystemTime(new Date('2026-10-08T05:01:00Z')); // 08:01 Moscow
      await service.flush();

      expect(telegram.send).toHaveBeenCalledTimes(1);
      expect(telegram.send.mock.calls[0][0]).toContain('(2)');
      expect(telegram.send.mock.calls[0][0]).toContain('first');
      expect(telegram.send.mock.calls[0][0]).toContain('second');
      expect(rows).toHaveLength(0);
    });

    it('re-sends button messages individually so the buttons keep working', async () => {
      const { service, telegram, rows } = setup();
      const buttons = [[{ text: 'Merge', callback_data: 'merge:1:abc' }]];
      await service.sendWithButtons('PR ready', buttons);

      jest.setSystemTime(new Date('2026-10-08T05:01:00Z'));
      await service.flush();

      expect(telegram.sendWithButtons).toHaveBeenCalledWith(
        '🌙 PR ready',
        buttons,
      );
      expect(rows).toHaveLength(0);
    });

    it('keeps the queue when Telegram refuses, to retry on the next tick', async () => {
      const { service, telegram, rows } = setup();
      await service.send('keep me');
      telegram.send.mockResolvedValue(false);

      jest.setSystemTime(new Date('2026-10-08T05:01:00Z'));
      await service.flush();

      expect(rows).toHaveLength(1);

      telegram.send.mockResolvedValue(true);
      await service.flush();

      expect(rows).toHaveLength(0);
    });
  });
});

describe('NotifyService urgent and weekends', () => {
  afterEach(() => jest.useRealTimers());

  const SATURDAY_NOON = new Date('2026-10-31T09:00:00Z');

  function make(
    now: Date,
    over: { quietWeekends?: boolean; allowUrgent?: boolean } = {},
  ) {
    jest.useFakeTimers().setSystemTime(now);

    const telegram = {
      isConfigured: jest.fn().mockReturnValue(true),
      send: jest.fn().mockResolvedValue(true),
      sendWithButtons: jest.fn().mockResolvedValue(true),
    };
    const save = jest.fn().mockResolvedValue(undefined);
    const settings = {
      effective: jest.fn().mockResolvedValue({
        window: { startMin: 23 * 60, endMin: 8 * 60 },
        timezone: 'Europe/Moscow',
        quietWeekends: over.quietWeekends ?? false,
        allowUrgent: over.allowUrgent ?? true,
      }),
    };
    const service = new NotifyService(
      telegram as never,
      settings as never,
      { save, find: jest.fn().mockResolvedValue([]) } as never,
    );

    return { service, telegram, save };
  }

  it('holds an ordinary notification on a quiet weekend afternoon, outside the daily window', async () => {
    const { service, telegram, save } = make(SATURDAY_NOON, {
      quietWeekends: true,
    });

    await service.send('weekend event');

    expect(telegram.send).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith({ text: 'weekend event', buttons: null });
  });

  it('delivers the same notification on a weekend when weekends are not quiet', async () => {
    const { service, telegram } = make(SATURDAY_NOON);

    await service.send('weekend event');

    expect(telegram.send).toHaveBeenCalledWith('weekend event');
  });

  it('lets an urgent notification through the silence, also with buttons', async () => {
    const { service, telegram, save } = make(SATURDAY_NOON, {
      quietWeekends: true,
    });

    await service.send('VPN down', { urgent: true });
    await service.sendWithButtons(
      'Merge?',
      [[{ text: 'ok', callback_data: 'x' }]],
      {
        urgent: true,
      },
    );

    expect(telegram.send).toHaveBeenCalledWith('VPN down');
    expect(telegram.sendWithButtons).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  it('queues an urgent notification too when the owner switched urgent off', async () => {
    const { service, telegram, save } = make(SATURDAY_NOON, {
      quietWeekends: true,
      allowUrgent: false,
    });

    await service.send('VPN down', { urgent: true });

    expect(telegram.send).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
  });
});
