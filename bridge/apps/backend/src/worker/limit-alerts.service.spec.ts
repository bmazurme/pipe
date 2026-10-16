import { LimitAlertsService } from './limit-alerts.service';
import type { ClaudeLimits } from './claude-limits';

const W = Math.floor(Date.parse('2026-10-21T00:00:00Z') / 1000);

const limits = (utilization: number): ClaudeLimits => ({
  status: 'allowed',
  rateLimitType: null,
  isUsingOverage: false,
  windows: { seven_day: { utilization, resetsAt: W } },
  reportedAt: '2026-10-16T12:00:00.000Z',
});

function setup() {
  let stored: { ownerKey: string; windows: Record<string, unknown> } | null =
    null;
  const states = {
    findOneBy: jest.fn(async () => stored),
    create: jest.fn((value: object) => ({ ...value }) as never),
    save: jest.fn(async (value: never) => {
      stored = value;

      return value;
    }),
  };
  const credentials = {
    findOne: jest.fn().mockResolvedValue({ id: 3, name: 'entools' }),
  };
  const workers = {
    findOne: jest.fn().mockResolvedValue({ id: 5, name: 'pi-blue' }),
  };
  const notifier = { send: jest.fn().mockResolvedValue(true) };
  const service = new LimitAlertsService(
    states as never,
    credentials as never,
    workers as never,
    notifier as never,
  );

  return {
    service,
    states,
    notifier,
    credentials,
    workers,
    get stored() {
      return stored;
    },
  };
}

describe('LimitAlertsService', () => {
  afterEach(() => {
    delete process.env.LIMIT_ALERTS;
  });

  it('sends one message naming the token and the worker when a window runs low, and none for the next report', async () => {
    const ctx = setup();

    const first = await ctx.service.check({
      userId: 1,
      workerId: 5,
      credentialId: 3,
      limits: limits(0.82),
    });

    expect(first).toHaveLength(1);
    expect(first[0]).toContain('токен «entools» · worker pi-blue');
    expect(first[0]).toContain('неделя 82%');
    expect(ctx.notifier.send).toHaveBeenCalledTimes(1);

    expect(
      await ctx.service.check({
        userId: 1,
        workerId: 5,
        credentialId: 3,
        limits: limits(0.84),
      }),
    ).toEqual([]);
    expect(ctx.notifier.send).toHaveBeenCalledTimes(1);
  });

  it('keeps what was announced per token (not per report), so a restart does not repeat it', async () => {
    const ctx = setup();

    await ctx.service.check({
      userId: 1,
      workerId: 5,
      credentialId: 3,
      limits: limits(0.82),
    });

    expect(ctx.stored?.ownerKey).toBe('1:c3');
    // a brand new service instance over the same stored state
    const again = new LimitAlertsService(
      { ...ctx.states, findOneBy: jest.fn(async () => ctx.stored) } as never,
      {
        findOne: jest.fn().mockResolvedValue({ id: 3, name: 'entools' }),
      } as never,
      {
        findOne: jest.fn().mockResolvedValue({ id: 5, name: 'pi-blue' }),
      } as never,
      ctx.notifier as never,
    );

    expect(
      await again.check({
        userId: 1,
        workerId: 5,
        credentialId: 3,
        limits: limits(0.83),
      }),
    ).toEqual([]);
  });

  it('files the limit under the worker when the token is not known, and under nothing for a legacy worker without one', async () => {
    const ctx = setup();

    await ctx.service.check({
      userId: 1,
      workerId: 5,
      credentialId: null,
      limits: limits(0.9),
    });
    expect(ctx.stored?.ownerKey).toBe('1:w5');

    const none = await ctx.service.check({
      userId: 1,
      credentialId: null,
      limits: limits(0.99),
    });

    expect(none).toEqual([]);
  });

  it('is silent for a comfortable report and when switched off', async () => {
    const ctx = setup();

    expect(
      await ctx.service.check({
        userId: 1,
        workerId: 5,
        credentialId: 3,
        limits: limits(0.3),
      }),
    ).toEqual([]);

    process.env.LIMIT_ALERTS = 'off';
    expect(
      await ctx.service.check({
        userId: 1,
        workerId: 5,
        credentialId: 3,
        limits: limits(0.99),
      }),
    ).toEqual([]);
    expect(ctx.notifier.send).not.toHaveBeenCalled();
  });

  it('never throws into the run: a failing store or channel is swallowed', async () => {
    const ctx = setup();

    ctx.states.findOneBy.mockRejectedValue(new Error('db down'));
    await expect(
      ctx.service.check({
        userId: 1,
        workerId: 5,
        credentialId: 3,
        limits: limits(0.9),
      }),
    ).resolves.toEqual([]);

    const flaky = setup();

    flaky.notifier.send.mockRejectedValue(new Error('telegram down'));
    await expect(
      flaky.service.check({
        userId: 1,
        workerId: 5,
        credentialId: 3,
        limits: limits(0.9),
      }),
    ).resolves.toEqual([]);
  });

  it('saves the state before sending, so a broken channel cannot repeat the same alert on every report', async () => {
    const ctx = setup();

    ctx.notifier.send.mockRejectedValue(new Error('telegram down'));
    await ctx.service.check({
      userId: 1,
      workerId: 5,
      credentialId: 3,
      limits: limits(0.9),
    });
    ctx.notifier.send.mockResolvedValue(true);

    expect(
      await ctx.service.check({
        userId: 1,
        workerId: 5,
        credentialId: 3,
        limits: limits(0.92),
      }),
    ).toEqual([]);
  });
});
