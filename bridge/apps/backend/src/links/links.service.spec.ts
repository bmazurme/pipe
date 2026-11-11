import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { E2eReportDto, LinkProbeReportDto } from './dto/link-probe.dto';
import * as probe from './link-probe';
import { ForbiddenException } from '@nestjs/common';
import { BRIDGE_VANTAGE, LinksService } from './links.service';

const link = (host: string, port = 443, sni = 'example.com') =>
  `vless://11111111-2222-3333-4444-555555555555@${host}:${port}?type=tcp&security=reality&encryption=none&fp=firefox&sni=${sni}&sid=&pbk=PUBKEY#x`;

function build(
  over: {
    connections?: Array<{ id: number; name: string; isActive: boolean }>;
    pools?: Record<number, string[] | Error>;
    rows?: Array<Record<string, unknown>>;
  } = {},
) {
  const rows = (over.rows ?? []).map((row) => ({ ...row }));
  const probes = {
    find: jest.fn(async (options?: { where?: { vantage: string } }) =>
      options?.where
        ? rows.filter((row) => row.vantage === options.where?.vantage)
        : rows,
    ),
    delete: jest.fn(async () => undefined),
    create: jest.fn((partial) => ({ ...partial })),
    save: jest.fn(async (saved: Array<Record<string, unknown>>) => saved),
  };
  const connections = { findAll: jest.fn(async () => over.connections ?? []) };
  const links = {
    resolveMany: jest.fn(async (id: number) => {
      const pool = over.pools?.[id];

      if (pool instanceof Error) throw pool;

      return pool ?? [];
    }),
  };

  const alerts = { evaluate: jest.fn(async () => undefined) };
  const workers = {
    findOneBy: jest.fn(async (where: { id: number }) =>
      where.id === 5 ? { id: 5, name: 'pi-red' } : null,
    ),
  };

  return {
    service: new LinksService(
      probes as never,
      connections as never,
      links as never,
      alerts as never,
      workers as never,
    ),
    workers,
    probes,
    connections,
    links,
    alerts,
  };
}

describe('LinksService.channels', () => {
  it('lists the host:port of every link of every connection, named after its connection, the active one first', async () => {
    const { service } = build({
      connections: [
        { id: 1, name: 'backup', isActive: false },
        { id: 2, name: 'main', isActive: true },
      ],
      pools: {
        1: [link('203.0.113.1')],
        2: [link('203.0.113.2', 8443, 'miro.com')],
      },
    });

    await expect(service.channels()).resolves.toEqual([
      {
        key: '203.0.113.2:8443',
        name: 'main',
        host: '203.0.113.2',
        port: 8443,
        sni: 'miro.com',
      },
      {
        key: '203.0.113.1:443',
        name: 'backup',
        host: '203.0.113.1',
        port: 443,
        sni: 'example.com',
      },
    ]);
  });

  it('numbers the channels of a pool', async () => {
    const { service } = build({
      connections: [{ id: 1, name: 'PaperVPN', isActive: true }],
      pools: { 1: [link('203.0.113.1'), link('203.0.113.2')] },
    });

    expect((await service.channels()).map((c) => c.name)).toEqual([
      'PaperVPN-1',
      'PaperVPN-2',
    ]);
  });

  it('leaves out a connection that cannot be read, and a link that cannot be parsed, and counts a shared host:port once', async () => {
    const { service } = build({
      connections: [
        { id: 1, name: 'down', isActive: true },
        { id: 2, name: 'a', isActive: false },
        { id: 3, name: 'b', isActive: false },
      ],
      pools: {
        1: new Error('panel unreachable'),
        2: [link('203.0.113.5'), 'vless://broken'],
        3: [link('203.0.113.5')],
      },
    });

    const channels = await service.channels();

    expect(channels).toHaveLength(1);
    // its pool had two entries (one of them broken), so the name is numbered
    expect(channels[0].name).toBe('a-1');
  });

  it('puts an IPv6 host without its brackets', async () => {
    const { service } = build({
      connections: [{ id: 1, name: 'v6', isActive: true }],
      pools: { 1: [link('[2001:db8::1]')] },
    });

    expect((await service.channels())[0]).toMatchObject({
      host: '2001:db8::1',
      key: '2001:db8::1:443',
    });
  });
});

describe('LinksService.ingest', () => {
  const NOW = new Date('2026-11-11T12:00:00Z');
  const before = {
    vantage: 'home',
    channelKey: 'a:443',
    result: 'ok',
    tcpMs: 20,
    tlsMs: 40,
    detail: null,
    probedAt: new Date('2026-11-11T11:59:00Z'),
    changedAt: new Date('2026-11-11T09:00:00Z'),
  };

  it('keeps "since when" while the result stays the same, and restarts it when it changes', async () => {
    const { service, probes } = build({
      rows: [before, { ...before, channelKey: 'b:443', result: 'ok' }],
    });

    await service.ingest(
      'home',
      [
        { key: 'a:443', result: 'ok', tcpMs: 25, tlsMs: 50 },
        { key: 'b:443', result: 'tcp_timeout', detail: 'ETIMEDOUT' },
      ],
      NOW,
    );

    const saved = probes.save.mock.calls[0][0] as Array<
      Record<string, unknown>
    >;

    expect(saved[0]).toMatchObject({
      result: 'ok',
      tcpMs: 25,
      changedAt: before.changedAt,
      probedAt: NOW,
    });
    expect(saved[1]).toMatchObject({
      result: 'tcp_timeout',
      tcpMs: null,
      detail: 'ETIMEDOUT',
      changedAt: NOW,
      probedAt: NOW,
    });
  });

  it('creates the row of a channel seen for the first time', async () => {
    const { service, probes } = build();

    await service.ingest(
      'home',
      [{ key: 'c:443', result: 'ok', tcpMs: 10, tlsMs: 20 }],
      NOW,
    );

    expect(probes.create).toHaveBeenCalledWith({
      vantage: 'home',
      channelKey: 'c:443',
    });
    expect(
      (probes.save.mock.calls[0][0] as Array<Record<string, unknown>>)[0],
    ).toMatchObject({ vantage: 'home', channelKey: 'c:443', changedAt: NOW });
  });

  it('only looks at the vantage point that reported, and does nothing for an empty report', async () => {
    const { service, probes } = build({
      rows: [before, { ...before, vantage: 'cloud' }],
    });

    await service.ingest('home', [{ key: 'a:443', result: 'ok' }], NOW);
    await service.ingest('home', [], NOW);

    expect(probes.find).toHaveBeenCalledTimes(1);
    expect(probes.find).toHaveBeenCalledWith({ where: { vantage: 'home' } });
    expect(probes.save).toHaveBeenCalledTimes(1);
  });
});

describe('LinksService: probing from bridge', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.LINK_PROBES;
  });

  const withTwo = () =>
    build({
      connections: [
        { id: 1, name: 'a', isActive: true },
        { id: 2, name: 'b', isActive: false },
      ],
      pools: { 1: [link('203.0.113.1')], 2: [link('203.0.113.2')] },
    });

  it('probes every channel and files the results under the bridge vantage point', async () => {
    const spy = jest
      .spyOn(probe, 'probeChannel')
      .mockImplementation(async (channel) => ({
        result: channel.host === '203.0.113.2' ? 'tcp_timeout' : 'ok',
        tcpMs: 5,
        tlsMs: 9,
        detail: null,
      }));
    const { service, probes } = withTwo();

    await expect(service.probeFromBridge()).resolves.toBe(2);

    expect(spy).toHaveBeenCalledTimes(2);
    const saved = probes.save.mock.calls[0][0] as Array<{
      vantage: string;
      channelKey: string;
      result: string;
    }>;

    expect(
      saved.map((row) => [row.vantage, row.channelKey, row.result]).sort(),
    ).toEqual([
      [BRIDGE_VANTAGE, '203.0.113.1:443', 'ok'],
      [BRIDGE_VANTAGE, '203.0.113.2:443', 'tcp_timeout'],
    ]);
  });

  it('does not probe at all when switched off, and not twice at once', async () => {
    const spy = jest
      .spyOn(probe, 'probeChannel')
      .mockImplementation(() => new Promise(() => undefined));
    const { service } = withTwo();

    process.env.LINK_PROBES = 'off';
    await service.tick();
    expect(spy).not.toHaveBeenCalled();

    delete process.env.LINK_PROBES;
    void service.tick();
    await new Promise((r) => setImmediate(r));
    await service.tick();
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('judges the channels after every probe round, with the view as it is by then', async () => {
    jest.spyOn(probe, 'probeChannel').mockResolvedValue({
      result: 'tcp_timeout',
      tcpMs: null,
      tlsMs: null,
      detail: 'ETIMEDOUT',
    });
    const { service, alerts } = withTwo();

    await service.tick();

    expect(alerts.evaluate).toHaveBeenCalledTimes(1);
    const view = (
      alerts.evaluate.mock.calls[0] as unknown as [
        { status: string; channels: unknown[] },
      ]
    )[0];

    expect(view.channels).toHaveLength(2);
  });

  it('survives a failing round: it is logged, the next one is not blocked', async () => {
    const { service, connections } = withTwo();
    connections.findAll.mockRejectedValueOnce(new Error('db down'));

    await expect(service.tick()).resolves.toBeUndefined();

    jest
      .spyOn(probe, 'probeChannel')
      .mockResolvedValue({ result: 'ok', tcpMs: 1, tlsMs: 1, detail: null });
    await expect(service.probeFromBridge()).resolves.toBe(2);
  });
});

describe('LinksService.view', () => {
  it('is the verdict over the channels and every stored probe', async () => {
    const now = new Date();
    const { service } = build({
      connections: [{ id: 1, name: 'a', isActive: true }],
      pools: { 1: [link('203.0.113.1')] },
      rows: [
        {
          vantage: 'bridge',
          channelKey: '203.0.113.1:443',
          result: 'tls_reset',
          tcpMs: 5,
          tlsMs: null,
          detail: 'ECONNRESET',
          probedAt: now,
          changedAt: now,
        },
      ],
    });

    const view = await service.view(now);

    expect(view.status).toBe('bad');
    expect(view.channels[0]).toMatchObject({ name: 'a', state: 'down' });
  });
});

describe('LinkProbeReportDto', () => {
  const errorsOf = async (body: unknown) =>
    (
      await validate(plainToInstance(LinkProbeReportDto, body), {
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    ).map((e) => e.property);
  const ok = {
    vantage: 'ubuntu-white',
    results: [
      { key: '203.0.113.1:443', result: 'ok', tcpMs: 20, tlsMs: 40 },
      { key: '2001:db8::1:443', result: 'tcp_timeout', detail: 'ETIMEDOUT' },
    ],
  };

  it('accepts what the agent sends', async () => {
    expect(await errorsOf(ok)).toEqual([]);
  });

  it.each([
    ['a vantage with a slash', { vantage: 'a/b' }],
    ['no results list', { results: 'x' }],
    [
      'too many results',
      {
        results: Array.from({ length: 61 }, () => ({
          key: 'a:443',
          result: 'ok',
        })),
      },
    ],
    ['an unknown result', { results: [{ key: 'a:443', result: 'great' }] }],
    [
      'a key that is not host:port',
      { results: [{ key: 'a b', result: 'ok' }] },
    ],
    [
      'a negative time',
      { results: [{ key: 'a:443', result: 'ok', tcpMs: -1 }] },
    ],
    ['a stray field', { shell: 'x' }],
  ])('refuses %s', async (_label, patch) => {
    expect((await errorsOf({ ...ok, ...patch })).length).toBeGreaterThan(0);
  });
});

describe('LinksService: a worker reporting through its tunnel', () => {
  const NOW = new Date('2026-11-11T12:00:00Z');

  it("files the results under the worker's name from its key, as the worker:<name> vantage point", async () => {
    const { service, probes } = build();

    await service.ingestWorker(
      5,
      [
        { key: 'e2e:claude', result: 'ok', tcpMs: 480 },
        { key: 'e2e:telegram', result: 'tls_timeout', detail: 'timeout' },
      ],
      NOW,
    );

    const saved = probes.save.mock.calls[0][0] as Array<
      Record<string, unknown>
    >;

    expect(
      saved.map((row) => [row.vantage, row.channelKey, row.result]),
    ).toEqual([
      ['worker:pi-red', 'e2e:claude', 'ok'],
      ['worker:pi-red', 'e2e:telegram', 'tls_timeout'],
    ]);
  });

  it('takes only the end-to-end keys: a worker has no business writing the probes of a channel', async () => {
    const { service, probes } = build();

    await service.ingestWorker(
      5,
      [
        { key: '203.0.113.1:443', result: 'ok' },
        { key: 'e2e:github', result: 'ok' },
      ],
      NOW,
    );

    const saved = probes.save.mock.calls[0][0] as Array<{ channelKey: string }>;

    expect(saved.map((row) => row.channelKey)).toEqual(['e2e:github']);
  });

  it('refuses a key that is not a managed worker (a personal API key has no worker behind it) and a worker that is gone', async () => {
    const { service, probes } = build();

    await expect(
      service.ingestWorker(undefined, [{ key: 'e2e:claude', result: 'ok' }]),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.ingestWorker(99, [{ key: 'e2e:claude', result: 'ok' }]),
    ).rejects.toThrow(ForbiddenException);
    expect(probes.save).not.toHaveBeenCalled();
  });

  it('drops the probes that nobody has refreshed for a week, after each round', async () => {
    const { service, probes } = build();
    jest
      .spyOn(probe, 'probeChannel')
      .mockResolvedValue({ result: 'ok', tcpMs: 1, tlsMs: 1, detail: null });

    await service.tick();

    expect(probes.delete).toHaveBeenCalledTimes(1);
    const where = (
      probes.delete.mock.calls[0] as unknown as [{ probedAt: { value: Date } }]
    )[0];

    expect(Date.now() - where.probedAt.value.getTime()).toBeGreaterThan(
      6.9 * 24 * 3600_000,
    );
  });
});

describe('LinkE2eReportDto', () => {
  const errorsOf = async (body: unknown) =>
    (
      await validate(plainToInstance(E2eReportDto, body), {
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    ).map((e) => e.property);

  it('accepts what the worker sends', async () => {
    expect(
      await errorsOf({
        results: [
          { key: 'e2e:claude', result: 'ok', tcpMs: 480 },
          { key: 'e2e:telegram', result: 'error', detail: 'HTTP 403' },
        ],
      }),
    ).toEqual([]);
  });

  it.each([
    [
      'a server channel key',
      { results: [{ key: '203.0.113.1:443', result: 'ok' }] },
    ],
    [
      'an unknown result',
      { results: [{ key: 'e2e:claude', result: 'great' }] },
    ],
    [
      'too many results',
      {
        results: Array.from({ length: 11 }, () => ({
          key: 'e2e:claude',
          result: 'ok',
        })),
      },
    ],
    [
      'a vantage name in the body (it comes from the key)',
      { vantage: 'x', results: [] },
    ],
  ])('refuses %s', async (_label, body) => {
    expect((await errorsOf(body)).length).toBeGreaterThan(0);
  });
});
