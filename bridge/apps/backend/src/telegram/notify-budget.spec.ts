import { NotificationSettingsService } from './notification-settings.service';
import { NotifyService } from './notify.service';

const DAY = new Date('2026-10-08T09:00:00Z'); // 12:00 Moscow
const NIGHT = new Date('2026-10-07T22:30:00Z'); // 01:30 Moscow

function setup(now = DAY) {
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
    kind: string;
    createdAt: Date;
  }> = [];
  let nextId = 1;
  const outbox = {
    save: jest.fn(
      async (row: { text: string; buttons: string | null; kind: string }) => {
        rows.push({ id: nextId++, createdAt: new Date(), ...row });
      },
    ),
    find: jest.fn(async () => [...rows]),
    delete: jest.fn(async (ids: number | number[]) => {
      for (const id of [ids].flat())
        rows.splice(
          rows.findIndex((row) => row.id === id),
          1,
        );
    }),
  };
  const settings = new NotificationSettingsService(
    { findOne: jest.fn().mockResolvedValue(null) } as never,
    { get: () => undefined } as never,
  );
  const stats = {
    attempt: jest.fn().mockResolvedValue(undefined),
    count: jest.fn().mockResolvedValue(undefined),
  };
  const service = new NotifyService(
    telegram as never,
    settings as never,
    outbox as never,
    undefined,
    stats as never,
  );

  return { service, telegram, rows, stats };
}

const counted = (stats: { count: jest.Mock }, counter: string) =>
  stats.count.mock.calls
    .filter((call) => call[0] === counter)
    .reduce((sum, call) => sum + (call[1] ?? 1), 0);

describe('NotifyService alert budget (R6)', () => {
  afterEach(() => jest.useRealTimers());

  describe('the same text again', () => {
    it('is not said again within the hour, and the caller is told it went (it must not retry)', async () => {
      const { service, telegram, stats } = setup();

      await service.send('Нет данных 12 мин');
      await expect(service.send('Нет данных 12 мин')).resolves.toBe(true);

      expect(telegram.send).toHaveBeenCalledTimes(1);
      expect(counted(stats, 'sent')).toBe(1);
      expect(counted(stats, 'deduped')).toBe(1);
    });

    it('is said again after the hour', async () => {
      const { service, telegram } = setup();

      await service.send('same');
      jest.setSystemTime(new Date(DAY.getTime() + 61 * 60_000));
      await service.send('same');

      expect(telegram.send).toHaveBeenCalledTimes(2);
    });

    it('is not mistaken for another event that differs only by a number', async () => {
      const { service, telegram } = setup();

      await service.send('🔀 Задача #7 → PR #55');
      await service.send('🔀 Задача #8 → PR #56');

      expect(telegram.send).toHaveBeenCalledTimes(2);
    });

    it('is deduplicated before it reaches the night queue: one row, not twenty', async () => {
      const { service, rows, stats } = setup(NIGHT);

      for (let i = 0; i < 20; i++) await service.send('🔴 канал недоступен');

      expect(rows).toHaveLength(1);
      expect(counted(stats, 'quiet')).toBe(1);
      expect(counted(stats, 'deduped')).toBe(19);
    });

    it('is not remembered when Telegram refused it: the next try goes out', async () => {
      const { service, telegram } = setup();

      telegram.send.mockResolvedValueOnce(false);

      await expect(service.send('x')).resolves.toBe(false);
      await expect(service.send('x')).resolves.toBe(true);
      expect(telegram.send).toHaveBeenCalledTimes(2);
    });

    it('is deduplicated when urgent too, over a shorter window', async () => {
      const { service, telegram } = setup();

      await service.send('🔴 down', { urgent: true });
      await service.send('🔴 down', { urgent: true });
      expect(telegram.send).toHaveBeenCalledTimes(1);

      jest.setSystemTime(new Date(DAY.getTime() + 16 * 60_000));
      await service.send('🔴 down', { urgent: true });
      expect(telegram.send).toHaveBeenCalledTimes(2);
    });
  });

  describe('a burst', () => {
    it('lets three through, then holds the rest, answering true', async () => {
      const { service, telegram, rows, stats } = setup();

      for (let i = 1; i <= 6; i++)
        await expect(service.send(`event ${i}`)).resolves.toBe(true);

      expect(telegram.send).toHaveBeenCalledTimes(3);
      expect(rows.map((row) => [row.text, row.kind])).toEqual([
        ['event 4', 'burst'],
        ['event 5', 'burst'],
        ['event 6', 'burst'],
      ]);
      expect(counted(stats, 'grouped')).toBe(3);
    });

    it('goes out as ONE grouped message once the burst has had time to end', async () => {
      const { service, telegram, rows, stats } = setup();

      for (let i = 1; i <= 6; i++) await service.send(`event ${i}`);
      telegram.send.mockClear();

      await service.flush();
      expect(telegram.send).not.toHaveBeenCalled();
      expect(rows).toHaveLength(3);

      jest.setSystemTime(new Date(DAY.getTime() + 60_000));
      await service.flush();

      expect(telegram.send).toHaveBeenCalledTimes(1);
      expect(telegram.send.mock.calls[0][0]).toMatch(
        /^🔔 Ещё 3 подряд \(сгруппировано\):\n• 12:00 event 4\n• 12:00 event 5\n• 12:00 event 6$/,
      );
      expect(rows).toHaveLength(0);
      expect(counted(stats, 'sent')).toBe(3 + 1);
    });

    it('keeps the held messages when Telegram refuses the group message', async () => {
      const { service, telegram, rows } = setup();

      for (let i = 1; i <= 5; i++) await service.send(`event ${i}`);
      jest.setSystemTime(new Date(DAY.getTime() + 60_000));
      telegram.send.mockResolvedValue(false);
      await service.flush();

      expect(rows).toHaveLength(2);
    });

    it('is calm again after two minutes', async () => {
      const { service, telegram } = setup();

      for (let i = 1; i <= 4; i++) await service.send(`event ${i}`);
      jest.setSystemTime(new Date(DAY.getTime() + 3 * 60_000));
      telegram.send.mockClear();

      await service.send('later');
      expect(telegram.send).toHaveBeenCalledWith('later');
    });

    it('never holds an urgent message', async () => {
      const { service, telegram } = setup();

      for (let i = 1; i <= 5; i++) await service.send(`event ${i}`);
      telegram.send.mockClear();

      await service.send('🔴 канал недоступен', { urgent: true });

      expect(telegram.send).toHaveBeenCalledWith('🔴 канал недоступен');
    });

    it('never holds or deduplicates a message with buttons, but it counts', async () => {
      const { service, telegram, stats } = setup();
      const buttons = [[{ text: 'Merge', callback_data: 'm' }]];

      for (let i = 1; i <= 5; i++) await service.send(`event ${i}`);
      await service.sendWithButtons('PR ready', buttons);
      await service.sendWithButtons('PR ready', buttons);

      expect(telegram.sendWithButtons).toHaveBeenCalledTimes(2);
      expect(counted(stats, 'sent')).toBe(3 + 2);
    });

    it('quiet hours win: at night nothing is grouped, it all waits for the morning digest', async () => {
      const { service, telegram, rows } = setup(NIGHT);

      for (let i = 1; i <= 6; i++) await service.send(`event ${i}`);

      expect(telegram.send).not.toHaveBeenCalled();
      expect(rows.every((row) => row.kind === 'quiet')).toBe(true);
    });
  });

  describe('the morning digest', () => {
    it('is one message, counted once', async () => {
      const { service, telegram, stats } = setup(NIGHT);

      await service.send('a');
      await service.send('b');
      jest.setSystemTime(DAY);
      await service.flush();

      expect(telegram.send).toHaveBeenCalledTimes(1);
      expect(counted(stats, 'sent')).toBe(1);
    });
  });

  describe('the statistics', () => {
    it('count every attempt by kind, even the ones that were not sent', async () => {
      const { service, stats } = setup();

      await service.send('x');
      await service.send('x');

      expect(stats.attempt).toHaveBeenCalledTimes(2);
    });

    it('never fail or delay a notification: a statistics service that rejects changes nothing', async () => {
      const { service, telegram, stats } = setup();

      stats.attempt.mockRejectedValue(new Error('db down'));
      stats.count.mockRejectedValue(new Error('db down'));

      await expect(service.send('still goes')).resolves.toBe(true);
      expect(telegram.send).toHaveBeenCalledWith('still goes');
    });

    it('are optional: without them the layer still works', async () => {
      const { telegram } = setup();
      const service = new NotifyService(
        telegram as never,
        new NotificationSettingsService(
          { findOne: jest.fn().mockResolvedValue(null) } as never,
          { get: () => undefined } as never,
        ) as never,
        {
          save: jest.fn(),
          find: jest.fn().mockResolvedValue([]),
          delete: jest.fn(),
        } as never,
      );

      await expect(service.send('x')).resolves.toBe(true);
      await expect(service.send('x')).resolves.toBe(true);
      expect(telegram.send).toHaveBeenCalledTimes(1);
    });
  });
});
