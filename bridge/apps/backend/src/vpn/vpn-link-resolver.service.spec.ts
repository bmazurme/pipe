import { LINK_TTL_MS, VpnLinkResolver } from './vpn-link-resolver.service';

function build() {
  const connections = {
    getActive: jest.fn().mockResolvedValue({ id: 8 }),
    findPooled: jest.fn().mockResolvedValue([]),
  };
  const vpn = {
    getConnectionLinks: jest.fn().mockResolvedValue(['vless://a']),
  };
  const subscriptions = {
    resolve: jest
      .fn()
      .mockResolvedValue({ link: 'vless://sub', links: ['vless://sub'] }),
  };
  const resolver = new VpnLinkResolver(
    connections as never,
    vpn as never,
    subscriptions as never,
  );

  return { resolver, connections, vpn, subscriptions };
}

describe('VpnLinkResolver', () => {
  afterEach(() => jest.restoreAllMocks());

  it('asks the panel once per minute per connection, however often workers poll', async () => {
    const { resolver, vpn } = build();

    await Promise.all([resolver.resolve(7), resolver.resolve(7)]);
    await resolver.resolve(7);

    expect(vpn.getConnectionLinks).toHaveBeenCalledTimes(1);

    const later = Date.now() + LINK_TTL_MS + 1;
    jest.spyOn(Date, 'now').mockReturnValue(later);
    await resolver.resolve(7);

    expect(vpn.getConnectionLinks).toHaveBeenCalledTimes(2);
  });

  it("resolves 'active' to the page's active connection", async () => {
    const { resolver, vpn } = build();

    await resolver.resolve('active');

    expect(vpn.getConnectionLinks).toHaveBeenCalledWith(8);
  });

  it('keeps handing out the last good link while the panel is down, but throws if there never was one', async () => {
    const { resolver, vpn } = build();

    await resolver.resolve(7);
    vpn.getConnectionLinks.mockRejectedValue(new Error('down'));
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + LINK_TTL_MS + 1);

    await expect(resolver.resolve(7)).resolves.toBe('vless://a');
    await expect(resolver.resolve(9)).rejects.toThrow('down');
  });
});

describe('VpnLinkResolver stale-while-revalidate', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns the stale link without awaiting a hanging panel', async () => {
    const { resolver, vpn } = build();

    await resolver.resolve(7);
    vpn.getConnectionLinks.mockReturnValue(new Promise(() => undefined));
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + LINK_TTL_MS + 1);

    await expect(resolver.resolve(7)).resolves.toBe('vless://a');
    expect(vpn.getConnectionLinks).toHaveBeenCalledTimes(2);
  });

  it('does not ask the panel again within one TTL after a failed refresh', async () => {
    const { resolver, vpn } = build();

    await resolver.resolve(7);
    vpn.getConnectionLinks.mockRejectedValue(new Error('down'));
    const start = Date.now() + LINK_TTL_MS + 1;
    const now = jest.spyOn(Date, 'now').mockReturnValue(start);

    await resolver.resolve(7);
    await new Promise((r) => setImmediate(r));
    await resolver.resolve(7);
    expect(vpn.getConnectionLinks).toHaveBeenCalledTimes(2);

    now.mockReturnValue(start + LINK_TTL_MS);
    await resolver.resolve(7);
    expect(vpn.getConnectionLinks).toHaveBeenCalledTimes(3);
  });
});

describe('VpnLinkResolver: a panel that never answered', () => {
  afterEach(() => jest.restoreAllMocks());

  it('is not asked again within one TTL, and is asked again after it', async () => {
    const { resolver, vpn } = build();
    vpn.getConnectionLinks.mockRejectedValue(new Error('down'));
    const start = Date.now();
    const now = jest.spyOn(Date, 'now').mockReturnValue(start);

    await expect(resolver.resolve(9)).rejects.toThrow('down');
    now.mockReturnValue(start + LINK_TTL_MS - 1);
    await expect(resolver.resolve(9)).rejects.toThrow('down');
    expect(vpn.getConnectionLinks).toHaveBeenCalledTimes(1);

    now.mockReturnValue(start + LINK_TTL_MS);
    await expect(resolver.resolve(9)).rejects.toThrow('down');
    expect(vpn.getConnectionLinks).toHaveBeenCalledTimes(2);
  });
});

describe('VpnLinkResolver: a subscription link of a worker', () => {
  afterEach(() => jest.restoreAllMocks());

  it('fetches the subscription once a minute, however often the worker polls', async () => {
    const { resolver, subscriptions } = build();

    await resolver.resolveSubscription('https://p.example/sub/a');
    await resolver.resolveSubscription('https://p.example/sub/a');
    await resolver.resolveSubscription('https://p.example/sub/b');

    expect(subscriptions.resolve).toHaveBeenCalledTimes(2);
    await expect(
      resolver.resolveSubscription('https://p.example/sub/a'),
    ).resolves.toBe('vless://sub');
  });

  it('keeps handing out the last good link while the provider is down, and tries again after a TTL', async () => {
    const { resolver, subscriptions } = build();

    await resolver.resolveSubscription('https://p.example/sub/a');
    subscriptions.resolve.mockRejectedValue(new Error('down'));
    const start = Date.now() + LINK_TTL_MS + 1;
    const now = jest.spyOn(Date, 'now').mockReturnValue(start);

    await expect(
      resolver.resolveSubscription('https://p.example/sub/a'),
    ).resolves.toBe('vless://sub');
    await resolver.resolveSubscription('https://p.example/sub/a');
    expect(subscriptions.resolve).toHaveBeenCalledTimes(2);

    now.mockReturnValue(start + LINK_TTL_MS);
    await resolver.resolveSubscription('https://p.example/sub/a');
    expect(subscriptions.resolve).toHaveBeenCalledTimes(3);
  });

  it('fails when a link was never fetched successfully', async () => {
    const { resolver, subscriptions } = build();
    subscriptions.resolve.mockRejectedValue(new Error('down'));

    await expect(
      resolver.resolveSubscription('https://p.example/sub/new'),
    ).rejects.toThrow('down');
  });

  it('checks a link fresh, without the cache', async () => {
    const { resolver, subscriptions } = build();

    await resolver.resolveSubscription('https://p.example/sub/a');
    await resolver.checkSubscription('https://p.example/sub/a');

    expect(subscriptions.resolve).toHaveBeenCalledTimes(2);
  });
});

describe('VpnLinkResolver: the pool', () => {
  afterEach(() => jest.restoreAllMocks());

  it('hands the whole pool of a connection and caches it as one', async () => {
    const { resolver, vpn } = build();
    vpn.getConnectionLinks.mockResolvedValue(['vless://a', 'vless://b']);

    await expect(resolver.resolveMany(7)).resolves.toEqual([
      'vless://a',
      'vless://b',
    ]);
    await expect(resolver.resolve(7)).resolves.toBe('vless://a');
    expect(vpn.getConnectionLinks).toHaveBeenCalledTimes(1);
  });

  it("hands the whole pool of a worker's own subscription, capped, and keeps the first for the single-link caller", async () => {
    const { resolver, subscriptions } = build();
    const many = Array.from({ length: 9 }, (_, i) => `vless://n${i}`);
    subscriptions.resolve.mockResolvedValue({ link: many[0], links: many });

    const pool = await resolver.resolveSubscriptionMany(
      'https://p.example/sub/a',
    );

    expect(pool).toHaveLength(6);
    expect(pool[0]).toBe('vless://n0');
    await expect(
      resolver.resolveSubscription('https://p.example/sub/a'),
    ).resolves.toBe('vless://n0');
  });
});

describe('VpnLinkResolver: connections in the pool', () => {
  afterEach(() => jest.restoreAllMocks());

  const linksByConnection =
    (map: Record<number, string[] | Error>) => (id: number) => {
      const links = map[id];

      return links instanceof Error
        ? Promise.reject(links)
        : Promise.resolve(links ?? []);
    };

  it("hands the active connection's links first, then those of the pooled ones", async () => {
    const { resolver, connections, vpn } = build();

    connections.findPooled.mockResolvedValue([{ id: 9, name: 'gru' }]);
    vpn.getConnectionLinks.mockImplementation(
      linksByConnection({ 8: ['vless://paper'], 9: ['vless://gru'] }),
    );

    await expect(resolver.resolveMany('active')).resolves.toEqual([
      'vless://paper',
      'vless://gru',
    ]);
    await expect(resolver.resolve('active')).resolves.toBe('vless://paper');
  });

  it('does not repeat a link two connections share, and stops at the pool limit', async () => {
    const { resolver, connections, vpn } = build();
    const many = (prefix: string) =>
      Array.from({ length: 5 }, (_, i) => `vless://${prefix}${i}`);

    connections.findPooled.mockResolvedValue([{ id: 9, name: 'b' }]);
    vpn.getConnectionLinks.mockImplementation(
      linksByConnection({
        8: ['vless://same', ...many('a')],
        9: ['vless://same', ...many('b')],
      }),
    );

    const links = await resolver.resolveMany('active');

    expect(links).toHaveLength(6);
    expect(new Set(links).size).toBe(6);
    expect(links[0]).toBe('vless://same');
  });

  it('skips a pooled connection that cannot be read — a spare must not break the main path — and says so once', async () => {
    const { resolver, connections, vpn } = build();
    const warn = jest
      .spyOn(resolver['logger'], 'warn')
      .mockImplementation(() => undefined);

    connections.findPooled.mockResolvedValue([{ id: 9, name: 'gru' }]);
    vpn.getConnectionLinks.mockImplementation(
      linksByConnection({ 8: ['vless://paper'], 9: new Error('panel down') }),
    );

    await expect(resolver.resolveMany('active')).resolves.toEqual([
      'vless://paper',
    ]);
    await expect(resolver.resolveMany('active')).resolves.toEqual([
      'vless://paper',
    ]);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('gru');
  });

  it('still fails when the ACTIVE connection cannot be read', async () => {
    const { resolver, connections, vpn } = build();

    connections.findPooled.mockResolvedValue([{ id: 9, name: 'gru' }]);
    vpn.getConnectionLinks.mockImplementation(
      linksByConnection({ 8: new Error('active down'), 9: ['vless://gru'] }),
    );

    await expect(resolver.resolveMany('active')).rejects.toThrow('active down');
  });

  it('a connection asked for by id is only itself, pool or not', async () => {
    const { resolver, connections, vpn } = build();

    connections.findPooled.mockResolvedValue([{ id: 9, name: 'gru' }]);
    vpn.getConnectionLinks.mockImplementation(
      linksByConnection({ 7: ['vless://seven'], 9: ['vless://gru'] }),
    );

    await expect(resolver.resolveMany(7)).resolves.toEqual(['vless://seven']);
    expect(connections.findPooled).not.toHaveBeenCalled();
  });
});
