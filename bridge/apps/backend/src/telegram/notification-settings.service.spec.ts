import { NotificationSettingsService } from './notification-settings.service';

type Row = { userId: number; quietHours: string; timezone: string };

function setup(rows: Row[] = [], config: Record<string, string> = {}) {
  const repository = {
    findOne: jest.fn(
      async ({ where, order }: { where: Partial<Row>; order?: object }) => {
        const matching = rows.filter((row) =>
          Object.entries(where).every(
            ([key, value]) => row[key as keyof Row] === value,
          ),
        );

        return (
          (order
            ? [...matching].sort((a, b) => a.userId - b.userId)
            : matching)[0] ?? null
        );
      },
    ),
    upsert: jest.fn(async (row: Row) => {
      const at = rows.findIndex((existing) => existing.userId === row.userId);

      if (at >= 0) rows[at] = row;
      else rows.push(row);
    }),
  };
  const service = new NotificationSettingsService(
    repository as never,
    { get: (key: string) => config[key] } as never,
  );

  return { service, repository, rows };
}

describe('NotificationSettingsService', () => {
  it('falls back to the built-in defaults', async () => {
    const { service } = setup();

    expect(await service.effective()).toMatchObject({
      quietHours: '23:00-08:00',
      timezone: 'Europe/Moscow',
      source: 'default',
    });
  });

  it('uses the env values until someone saves their own', async () => {
    const { service } = setup([], {
      NOTIFY_QUIET_HOURS: '22:00-07:00',
      NOTIFY_TIMEZONE: 'Asia/Almaty',
    });

    expect(await service.effective()).toMatchObject({
      quietHours: '22:00-07:00',
      timezone: 'Asia/Almaty',
      source: 'default',
    });
  });

  it('lets the lowest user id with saved settings own the shared chat', async () => {
    const { service } = setup([
      { userId: 7, quietHours: 'off', timezone: 'UTC' },
      { userId: 3, quietHours: '01:00-06:00', timezone: 'Europe/Berlin' },
    ]);

    const effective = await service.effective();

    expect(effective).toMatchObject({
      quietHours: '01:00-06:00',
      timezone: 'Europe/Berlin',
      source: 'profile',
    });
    expect(effective.window).toEqual({ startMin: 60, endMin: 360 });
  });

  it('parses "off" as no window', async () => {
    const { service } = setup([
      { userId: 1, quietHours: 'off', timezone: 'UTC' },
    ]);

    expect((await service.effective()).window).toBeNull();
  });

  it('caches reads and drops the cache on save', async () => {
    const { service, repository } = setup();

    await service.effective();
    await service.effective();
    expect(repository.findOne).toHaveBeenCalledTimes(1);

    await service.save(1, '21:00-06:00', 'UTC');

    expect((await service.effective()).quietHours).toBe('21:00-06:00');
  });

  it('rejects a malformed window and an unknown time zone', async () => {
    const { service, rows } = setup();

    await expect(service.save(1, '25:00-08:00', 'UTC')).rejects.toThrow(
      /NOTIFY_QUIET_HOURS/,
    );
    await expect(service.save(1, '23:00-08:00', 'Mars/Base')).rejects.toThrow(
      /Unknown time zone/,
    );
    expect(rows).toHaveLength(0);
  });

  describe('forUser', () => {
    it('shows a non-owner their own values and that they do not drive the chat', async () => {
      const { service } = setup([
        { userId: 1, quietHours: '23:00-08:00', timezone: 'Europe/Moscow' },
        { userId: 2, quietHours: 'off', timezone: 'UTC' },
      ]);

      expect(await service.forUser(2)).toMatchObject({
        quietHours: 'off',
        isCustom: true,
        appliesToChat: false,
      });
      expect(await service.forUser(1)).toMatchObject({
        isCustom: true,
        appliesToChat: true,
      });
    });

    it('shows an account without settings what is currently in effect', async () => {
      const { service } = setup();

      expect(await service.forUser(5)).toMatchObject({
        quietHours: '23:00-08:00',
        timezone: 'Europe/Moscow',
        isCustom: false,
        appliesToChat: true,
      });
    });
  });
});
