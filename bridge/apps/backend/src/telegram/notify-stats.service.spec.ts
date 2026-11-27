import { NotificationSettingsService } from './notification-settings.service';
import { NotifyStatsService } from './notify-stats.service';

function make(
  rows: Array<Record<string, unknown>> = [],
  kinds: Array<Record<string, unknown>> = [],
  timezone = 'Europe/Moscow',
) {
  const days = {
    query: jest.fn().mockResolvedValue(undefined),
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(rows),
    })),
  };
  const kindRepo = {
    query: jest.fn().mockResolvedValue(undefined),
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(kinds),
    })),
  };
  const settings = {
    effective: jest.fn().mockResolvedValue({ timezone }),
  } as unknown as NotificationSettingsService;
  const service = new NotifyStatsService(
    days as never,
    kindRepo as never,
    settings,
  );

  return { service, days, kindRepo };
}

describe('NotifyStatsService', () => {
  it("names the day by the OWNER's clock, not UTC", async () => {
    const { service } = make();

    // 22:30 UTC on the 7th is already the 8th in Moscow.
    await expect(service.dayOf(new Date('2026-10-07T22:30:00Z'))).resolves.toBe(
      '2026-10-08',
    );
    await expect(service.dayOf(new Date('2026-10-07T20:30:00Z'))).resolves.toBe(
      '2026-10-07',
    );
  });

  it('adds to the counter of the day in one statement', async () => {
    const { service, days } = make();

    await service.count('deduped', 3, new Date('2026-10-08T09:00:00Z'));

    expect(days.query).toHaveBeenCalledWith(
      expect.stringContaining(
        'ON CONFLICT (day) DO UPDATE SET "deduped" = notify_days."deduped" + $2',
      ),
      ['2026-10-08', 3],
    );
  });

  it('counts an attempt by kind: the first line, digits as N', async () => {
    const { service, kindRepo } = make();

    await service.attempt(
      '🔴 Задача #7: не удалось\nвторая строка',
      new Date('2026-10-08T09:00:00Z'),
    );

    expect(kindRepo.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (day, kind)'),
      ['2026-10-08', '🔴 Задача #N: не удалось'],
    );
  });

  it('never throws: a database that is down is a warning', async () => {
    const { service, days, kindRepo } = make();

    days.query.mockRejectedValue(new Error('db down'));
    kindRepo.query.mockRejectedValue(new Error('db down'));

    await expect(service.count('sent')).resolves.toBeUndefined();
    await expect(service.attempt('x')).resolves.toBeUndefined();
  });

  it('removes old days once a day, from a write that happens anyway', async () => {
    const { service, days, kindRepo } = make();
    const now = new Date('2026-10-08T09:00:00Z');

    await service.count('sent', 1, now);
    await service.count('sent', 1, new Date(now.getTime() + 60_000));

    expect(
      days.query.mock.calls.filter((call) =>
        String(call[0]).startsWith('DELETE'),
      ),
    ).toHaveLength(1);
    expect(
      kindRepo.query.mock.calls.filter((call) =>
        String(call[0]).startsWith('DELETE'),
      ),
    ).toHaveLength(1);
    expect(days.query).toHaveBeenCalledWith(
      'DELETE FROM notify_days WHERE day < $1',
      ['2026-08-24'],
    );
  });

  describe('budget', () => {
    const row = (day: string, sent: number, over = {}) => ({
      day,
      sent,
      urgent: 0,
      deduped: 0,
      grouped: 0,
      quiet: 0,
      ...over,
    });

    it('says today against the target, with the verdict and who is noisy', async () => {
      const { service } = make(
        [
          row('2026-10-08', 7, {
            deduped: 12,
            grouped: 4,
            quiet: 2,
            urgent: 1,
          }),
          row('2026-10-07', 3),
        ],
        [{ kind: '🔴 Задача #N: не удалось открыть PR', attempts: 9 }],
      );
      const view = await service.budget(14, new Date('2026-10-08T09:00:00Z'));

      expect(view.target).toBe(5);
      expect(view.noisy).toBe(15);
      expect(view.today).toMatchObject({
        day: '2026-10-08',
        sent: 7,
        deduped: 12,
        grouped: 4,
        quiet: 2,
        urgent: 1,
        verdict: 'over',
      });
      expect(view.today.top).toEqual([
        { kind: '🔴 Задача #N: не удалось открыть PR', attempts: 9 },
      ]);
      expect(view.days.map((day) => day.day)).toEqual([
        '2026-10-08',
        '2026-10-07',
      ]);
    });

    it('is a calm zero for a day with no messages at all', async () => {
      const { service } = make([row('2026-10-07', 3)]);
      const view = await service.budget(14, new Date('2026-10-08T09:00:00Z'));

      expect(view.today).toMatchObject({
        day: '2026-10-08',
        sent: 0,
        verdict: 'ok',
        top: [],
      });
    });

    it('is noisy from fifteen', async () => {
      const { service } = make([row('2026-10-08', 15)]);

      expect(
        (await service.budget(14, new Date('2026-10-08T09:00:00Z'))).today
          .verdict,
      ).toBe('noisy');
    });
  });
});
