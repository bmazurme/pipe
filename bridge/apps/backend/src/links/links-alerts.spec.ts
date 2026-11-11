import { desiredAlerts } from './links-alerts';
import {
  CONFIRM_ANNOUNCE,
  CONFIRM_RECOVER,
  LinksAlertsService,
} from './links-alerts.service';
import { ChannelsView, ChannelState } from './links';

const channel = (
  name: string,
  state: ChannelState,
  reason: string | null = null,
) => ({
  key: `${name}:443`,
  name,
  host: name,
  port: 443,
  sni: 'example.com',
  state,
  cells: [],
  reason,
});
const view = (
  channels: ReturnType<typeof channel>[],
  vantages: ChannelsView['vantages'] = [],
  e2e: ChannelsView['e2e'] = [],
): ChannelsView => ({
  status: 'ok',
  reasons: [],
  channels,
  vantages,
  e2e,
  e2eVantages: [],
});

describe('desiredAlerts', () => {
  it('has nothing to say when every channel is fine', () => {
    expect(
      desiredAlerts(view([channel('a', 'ok'), channel('b', 'ok')])),
    ).toEqual([]);
  });

  it('says it urgently when no channel reaches, and says only that (not once more per channel)', () => {
    const alerts = desiredAlerts(
      view([channel('a', 'down', 'x'), channel('b', 'down', 'y')]),
    );

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ key: 'none-reachable', urgent: true });
    expect(alerts[0].text).toContain('каналов: 2');
  });

  it('does not call a pool nobody has probed yet a failure', () => {
    expect(
      desiredAlerts(view([channel('a', 'unknown'), channel('b', 'unknown')])),
    ).toEqual([]);
  });

  it('warns that one live channel is left, and names it, and each dead one on its own', () => {
    const alerts = desiredAlerts(
      view([
        channel('a', 'ok'),
        channel('b', 'down', 'не доходит ни из одной точки: тишина'),
        channel('c', 'down', 'z'),
      ]),
    );

    expect(alerts.map((a) => a.key)).toEqual([
      'one-left',
      'channel:b:443',
      'channel:c:443',
    ]);
    expect(alerts[0].text).toContain('a (a:443)');
    expect(alerts[1]).toMatchObject({
      urgent: false,
      text: '🔌 VPN-канал b (b:443): не доходит ни из одной точки: тишина',
      recovered: '✅ VPN-канал b снова доступен',
    });
  });

  it('names a channel that is blocked from some points only', () => {
    const alerts = desiredAlerts(
      view([
        channel('a', 'partial', 'не доходит из: bridge — нет ответа'),
        channel('b', 'ok'),
      ]),
    );

    expect(alerts.map((a) => a.key)).toEqual(['channel:a:443']);
  });

  it("is not a single-channel pool's fault to have one channel", () => {
    expect(desiredAlerts(view([channel('a', 'ok')]))).toEqual([]);
  });

  it('says when a vantage point stopped reporting', () => {
    const alerts = desiredAlerts(
      view(
        [channel('a', 'ok')],
        [
          { name: 'home', lastProbeAt: '2026-11-11T10:00:00Z', stale: true },
          { name: 'bridge', lastProbeAt: '2026-11-11T10:00:00Z', stale: false },
        ],
      ),
    );

    expect(alerts).toEqual([
      {
        key: 'vantage:home',
        text: '📡 Точка наблюдения «home» не присылает пробы каналов',
        urgent: false,
        recovered: '✅ Точка «home» снова присылает пробы',
      },
    ]);
  });
});

describe('LinksAlertsService', () => {
  const NOW = new Date('2026-11-11T12:00:00Z');
  const build = (
    stored: Array<{ key: string; since: Date; recovered: string }> = [],
  ) => {
    const rows = [...stored];
    const alerts = {
      find: jest.fn(async () => [...rows]),
      save: jest.fn(
        async (row: { key: string; since: Date; recovered: string }) =>
          void rows.push(row),
      ),
      delete: jest.fn(
        async ({ key }: { key: string }) =>
          void rows.splice(
            rows.findIndex((r) => r.key === key),
            1,
          ),
      ),
    };
    const notifier = { send: jest.fn(async () => true) };

    return {
      service: new LinksAlertsService(alerts as never, notifier as never),
      alerts,
      notifier,
      rows,
    };
  };
  const bad = view([channel('a', 'down', 'x'), channel('b', 'down', 'y')]);
  const good = view([channel('a', 'ok'), channel('b', 'ok')]);
  const oneDown = view([
    channel('a', 'ok'),
    channel('b', 'down', 'не доходит ни из одной точки: тишина'),
    channel('c', 'ok'),
  ]);

  afterEach(() => delete process.env.LINK_ALERTS);

  it(`announces a condition only after it held ${CONFIRM_ANNOUNCE} checks in a row — urgent when the whole pool is gone`, async () => {
    const { service, notifier, alerts } = build();

    await service.evaluate(bad, NOW);
    expect(notifier.send).not.toHaveBeenCalled();

    await service.evaluate(bad, NOW);
    expect(notifier.send).toHaveBeenCalledTimes(1);
    expect(notifier.send).toHaveBeenCalledWith(
      expect.stringContaining('Ни один VPN-канал не доходит'),
      { urgent: true },
    );
    expect(alerts.save).toHaveBeenCalledWith({
      key: 'none-reachable',
      since: NOW,
      recovered: '✅ VPN-каналы снова доходят',
    });
  });

  it('says nothing more while the condition lasts', async () => {
    const { service, notifier } = build();

    for (let i = 0; i < 6; i += 1) await service.evaluate(bad, NOW);

    expect(notifier.send).toHaveBeenCalledTimes(1);
  });

  it('does not announce a condition that came and went (a flap) before it was confirmed', async () => {
    const { service, notifier } = build();

    await service.evaluate(oneDown, NOW);
    await service.evaluate(good, NOW);
    await service.evaluate(oneDown, NOW);
    await service.evaluate(good, NOW);

    expect(notifier.send).not.toHaveBeenCalled();
  });

  it(`announces it as over after ${CONFIRM_RECOVER} clean checks, once, with the words saved when it began`, async () => {
    const { service, notifier, rows } = build();

    await service.evaluate(oneDown, NOW);
    await service.evaluate(oneDown, NOW);
    expect(rows.map((r) => r.key)).toEqual(['channel:b:443']);
    notifier.send.mockClear();

    await service.evaluate(good, NOW);
    await service.evaluate(good, NOW);
    expect(notifier.send).not.toHaveBeenCalled();

    await service.evaluate(good, NOW);
    expect(notifier.send).toHaveBeenCalledTimes(1);
    expect(notifier.send).toHaveBeenCalledWith('✅ VPN-канал b снова доступен');
    expect(rows).toEqual([]);

    await service.evaluate(good, NOW);
    expect(notifier.send).toHaveBeenCalledTimes(1);
  });

  it('does not say "over" for a condition that came back before it was confirmed over', async () => {
    const { service, notifier } = build([
      { key: 'channel:b:443', since: NOW, recovered: '✅ b' },
    ]);

    await service.evaluate(good, NOW);
    await service.evaluate(good, NOW);
    await service.evaluate(oneDown, NOW);
    await service.evaluate(good, NOW);
    await service.evaluate(good, NOW);

    expect(notifier.send).not.toHaveBeenCalled();
  });

  it('does not repeat a condition after a restart: what was announced is in the database', async () => {
    const { service, notifier } = build([
      { key: 'channel:b:443', since: NOW, recovered: '✅ b' },
    ]);

    await service.evaluate(oneDown, NOW);
    await service.evaluate(oneDown, NOW);

    expect(notifier.send).not.toHaveBeenCalled();
  });

  it('announces a new condition on top of the ones already announced', async () => {
    const { service, notifier } = build([
      { key: 'channel:b:443', since: NOW, recovered: '✅ b' },
    ]);
    const worse = view([
      channel('a', 'down', 'x'),
      channel('b', 'down', 'y'),
      channel('c', 'ok'),
    ]);

    await service.evaluate(worse, NOW);
    await service.evaluate(worse, NOW);

    expect(notifier.send).toHaveBeenCalledTimes(2);
    expect(
      (notifier.send.mock.calls as unknown as string[][])
        .map(([text]) => text)
        .sort(),
    ).toEqual(
      [
        '⚠️ Остался один живой VPN-канал: c (c:443). Остальные не доходят — пора добавлять запасные.',
        '🔌 VPN-канал a (a:443): x',
      ].sort(),
    );
  });

  it('does nothing when switched off', async () => {
    process.env.LINK_ALERTS = 'off';
    const { service, notifier, alerts } = build();

    await service.evaluate(bad, NOW);
    await service.evaluate(bad, NOW);

    expect(alerts.find).not.toHaveBeenCalled();
    expect(notifier.send).not.toHaveBeenCalled();
  });

  it('never throws, and a send that fails is not retried on every check', async () => {
    const { service, notifier, alerts } = build();

    notifier.send.mockRejectedValue(new Error('telegram down'));
    await service.evaluate(bad, NOW);
    await expect(service.evaluate(bad, NOW)).resolves.toBeUndefined();
    await service.evaluate(bad, NOW);

    expect(alerts.save).toHaveBeenCalledTimes(1);
    expect(notifier.send).toHaveBeenCalledTimes(1);
  });

  it('works without a Telegram bot configured (nothing to send through)', async () => {
    const alerts = {
      find: jest.fn(async () => []),
      save: jest.fn(),
      delete: jest.fn(),
    };
    const service = new LinksAlertsService(alerts as never);

    await service.evaluate(bad, NOW);
    await expect(service.evaluate(bad, NOW)).resolves.toBeUndefined();
    expect(alerts.save).toHaveBeenCalledTimes(1);
  });
});
