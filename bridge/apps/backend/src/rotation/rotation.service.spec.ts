import { RotationService } from './rotation.service';

const NOW = new Date('2026-12-10T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function setup(
  options: {
    rows?: {
      key: string;
      lastRotatedAt: Date | null;
      notifiedAt?: Date | null;
    }[];
    copies?: object[];
    pending?: number;
    owner?: number | null;
  } = {},
) {
  const rows = options.rows ?? [];
  const items = {
    find: jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve(rows.map((r) => ({ notifiedAt: null, ...r }))),
      ),
    upsert: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const checks = {
    find: jest.fn().mockResolvedValue(options.copies ?? []),
    findOne: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue(undefined),
  };
  const reencrypt = {
    status: jest
      .fn()
      .mockResolvedValue({ pending: options.pending ?? 0, currentKeyId: 'v2' }),
  };
  const notifier = { send: jest.fn().mockResolvedValue(true) };
  const access = {
    ownerId: jest
      .fn()
      .mockResolvedValue(options.owner === undefined ? 7 : options.owner),
  };
  const service = new RotationService(
    items as never,
    checks as never,
    reencrypt as never,
    notifier as never,
    access as never,
  );

  return { items, checks, reencrypt, notifier, access, service };
}

const ALL_FRESH = [
  'jwt',
  'enc-key',
  'age-key',
  'telegram-bot',
  'db-password',
].map((key) => ({
  key,
  lastRotatedAt: daysAgo(10),
}));

const copyRow = (label: string, okDaysAgo: number) => ({
  label,
  ok: true,
  lastCheckAt: daysAgo(okDaysAgo),
  lastOkAt: daysAgo(okDaysAgo),
  backupCreatedAt: '20261209T030000Z',
  error: null,
});

describe('RotationService', () => {
  it('creates the missing calendar rows on first look', async () => {
    const { items, service } = setup({
      rows: [{ key: 'jwt', lastRotatedAt: null }],
    });

    await service.view(7, NOW);

    expect(items.upsert).toHaveBeenCalledTimes(1);
    expect(
      items.upsert.mock.calls[0][0].map((r: { key: string }) => r.key),
    ).toEqual(['enc-key', 'age-key', 'telegram-bot', 'db-password']);
  });

  it('is calm when everything was changed recently and two copies of the key work', async () => {
    const { service } = setup({
      rows: ALL_FRESH,
      copies: [copyRow('mac', 5), copyRow('usb', 30)],
    });

    const view = await service.view(7, NOW);

    expect(view.status).toBe('ok');
    expect(view.keyCopies.verified).toBe(2);
    expect(view.items.find((i) => i.key === 'jwt')).toMatchObject({
      status: 'ok',
      daysLeft: 355,
    });
  });

  it('judges the age key by its copies, not by a date', async () => {
    const { service } = setup({ rows: ALL_FRESH, copies: [copyRow('mac', 5)] });

    const view = await service.view(7, NOW);

    expect(view.items.find((i) => i.key === 'age-key')).toMatchObject({
      status: 'warn',
    });
    expect(view.status).toBe('warn');
  });

  it('shows values still under an old encryption key on the encryption key item', async () => {
    const { service } = setup({
      rows: ALL_FRESH,
      copies: [copyRow('mac', 5), copyRow('usb', 5)],
      pending: 9,
    });

    const item = (await service.view(7, NOW)).items.find(
      (i) => i.key === 'enc-key',
    );

    expect(item).toMatchObject({ status: 'warn', pendingValues: 9 });
    expect(item?.reasons[0]).toMatch(/9 значений/);
  });

  it('still answers when the values under old keys cannot be counted', async () => {
    const { service, reencrypt } = setup({
      rows: ALL_FRESH,
      copies: [copyRow('mac', 5), copyRow('usb', 5)],
    });

    reencrypt.status.mockRejectedValue(
      new Error('CREDENTIALS_ENC_KEY_CURRENT must look like'),
    );

    const item = (await service.view(7, NOW)).items.find(
      (i) => i.key === 'enc-key',
    );

    expect(item).toMatchObject({ status: 'ok', pendingValues: null });
  });

  describe('markRotated', () => {
    it('starts the interval again and re-arms the reminder', async () => {
      const { items, service } = setup({ rows: ALL_FRESH });

      await service.markRotated(7, 'jwt', undefined, NOW);

      expect(items.update).toHaveBeenCalledWith(
        { userId: 7, key: 'jwt' },
        { lastRotatedAt: NOW, notifiedAt: null },
      );
    });

    it('takes an earlier date the owner names', async () => {
      const { items, service } = setup({ rows: ALL_FRESH });

      await service.markRotated(7, 'jwt', '2026-06-01T00:00:00Z', NOW);

      expect(items.update.mock.calls[0][1].lastRotatedAt).toEqual(
        new Date('2026-06-01T00:00:00Z'),
      );
    });

    it.each([
      ['an unknown key', 'nope', undefined],
      ['the age key (it has no date)', 'age-key', undefined],
      ['a date in the future', 'jwt', '2027-06-01T00:00:00Z'],
    ])('refuses %s', async (_name, key, at) => {
      const { service } = setup({ rows: ALL_FRESH });

      await expect(service.markRotated(7, key, at, NOW)).rejects.toThrow();
    });
  });

  describe('recordKeyCheck', () => {
    it('keeps the last good time when a later check fails, and says so at once', async () => {
      const { checks, notifier, service } = setup();

      checks.findOne.mockResolvedValue({
        lastOkAt: daysAgo(40),
        backupCreatedAt: '20261101T030000Z',
      });

      await service.recordKeyCheck(
        7,
        { label: 'usb', ok: false, error: 'no identity matched' },
        NOW,
      );

      expect(checks.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'usb',
          ok: false,
          lastOkAt: daysAgo(40),
          error: 'no identity matched',
        }),
        ['userId', 'label'],
      );
      expect(notifier.send).toHaveBeenCalledWith(
        expect.stringContaining('«usb»'),
        { urgent: true },
      );
    });

    it('moves the good time forward on a good check, and stays quiet', async () => {
      const { checks, notifier, service } = setup();

      await service.recordKeyCheck(
        7,
        { label: 'mac', ok: true, backupCreatedAt: '20261209T030000Z' },
        NOW,
      );

      expect(checks.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'mac',
          ok: true,
          lastOkAt: NOW,
          error: null,
        }),
        ['userId', 'label'],
      );
      expect(notifier.send).not.toHaveBeenCalled();
    });
  });

  describe('sweep', () => {
    const overdue = ALL_FRESH.map((r) =>
      r.key === 'jwt' ? { ...r, lastRotatedAt: daysAgo(400) } : r,
    );
    const good = [copyRow('mac', 5), copyRow('usb', 5)];

    it('tells the owner about an overdue rotation once, and marks it first', async () => {
      const { notifier, items, service } = setup({
        rows: overdue,
        copies: good,
      });

      expect(await service.sweep(NOW)).toBe(1);
      expect(notifier.send).toHaveBeenCalledWith(
        expect.stringContaining('JWT_SECRET'),
      );
      expect(items.update).toHaveBeenCalledWith(
        { userId: 7, key: 'jwt' },
        { notifiedAt: NOW },
      );
    });

    it('does not repeat within a week, but does after', async () => {
      const recent = overdue.map((r) =>
        r.key === 'jwt' ? { ...r, notifiedAt: daysAgo(3) } : r,
      );
      const stale = overdue.map((r) =>
        r.key === 'jwt' ? { ...r, notifiedAt: daysAgo(8) } : r,
      );

      expect(
        await setup({ rows: recent, copies: good }).service.sweep(NOW),
      ).toBe(0);
      expect(
        await setup({ rows: stale, copies: good }).service.sweep(NOW),
      ).toBe(1);
    });

    it('stays quiet when only warnings exist, and when there is no owner', async () => {
      expect(
        await setup({
          rows: ALL_FRESH,
          copies: [copyRow('mac', 5)],
        }).service.sweep(NOW),
      ).toBe(0);
      expect(
        await setup({ rows: overdue, copies: good, owner: null }).service.sweep(
          NOW,
        ),
      ).toBe(0);
    });
  });
});
