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
  const service = new NotifyService(
    telegram as never,
    { get: (key: string) => config[key] } as never,
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
