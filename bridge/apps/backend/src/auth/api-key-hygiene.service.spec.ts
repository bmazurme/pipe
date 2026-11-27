import { ApiKeyHygieneService } from './api-key-hygiene.service';

const NOW = new Date('2026-11-27T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const row = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'sync-cli',
  prefix: 'brk_AAAAAAAA',
  createdAt: daysAgo(100),
  lastUsedAt: daysAgo(40),
  expiresAt: null,
  revokedAt: null,
  notifiedStaleAt: null,
  notifiedExpiringAt: null,
  ...over,
});

function setup(rows: unknown[]) {
  const keys = {
    findForHygiene: jest.fn().mockResolvedValue(rows),
    markNotified: jest.fn().mockResolvedValue(undefined),
  };
  const notifier = { send: jest.fn().mockResolvedValue(true) };

  return {
    service: new ApiKeyHygieneService(keys as never, notifier as never),
    keys,
    notifier,
  };
}

describe('ApiKeyHygieneService', () => {
  it('tells the owner about a key idle for a month and marks it, so it is told once', async () => {
    const { service, keys, notifier } = setup([row()]);

    expect(await service.sweep(NOW)).toBe(1);
    expect(keys.markNotified).toHaveBeenCalledWith(1, 'stale');
    expect(notifier.send).toHaveBeenCalledWith(
      expect.stringContaining('40 дн.'),
    );
  });

  it('does nothing for healthy or already-told keys', async () => {
    const { service, notifier } = setup([
      row({ lastUsedAt: daysAgo(1) }),
      row({ id: 2, notifiedStaleAt: daysAgo(3) }),
    ]);

    expect(await service.sweep(NOW)).toBe(0);
    expect(notifier.send).not.toHaveBeenCalled();
  });

  it('marks before it sends, and survives a failing send', async () => {
    const { service, keys, notifier } = setup([row()]);

    notifier.send.mockRejectedValueOnce(new Error('telegram down'));

    expect(await service.sweep(NOW)).toBe(0);
    expect(keys.markNotified).toHaveBeenCalled();
  });

  it('does nothing without a notifier', async () => {
    const keys = { findForHygiene: jest.fn(), markNotified: jest.fn() };

    expect(await new ApiKeyHygieneService(keys as never).sweep(NOW)).toBe(0);
    expect(keys.findForHygiene).not.toHaveBeenCalled();
  });
});
