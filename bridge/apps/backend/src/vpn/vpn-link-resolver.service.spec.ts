import { LINK_TTL_MS, VpnLinkResolver } from './vpn-link-resolver.service';

function build() {
  const connections = { getActive: jest.fn().mockResolvedValue({ id: 8 }) };
  const vpn = {
    getConnectionLink: jest.fn().mockResolvedValue({ link: 'vless://a' }),
  };
  const resolver = new VpnLinkResolver(connections as never, vpn as never);

  return { resolver, connections, vpn };
}

describe('VpnLinkResolver', () => {
  afterEach(() => jest.restoreAllMocks());

  it('asks the panel once per minute per connection, however often workers poll', async () => {
    const { resolver, vpn } = build();

    await Promise.all([resolver.resolve(7), resolver.resolve(7)]);
    await resolver.resolve(7);

    expect(vpn.getConnectionLink).toHaveBeenCalledTimes(1);

    const later = Date.now() + LINK_TTL_MS + 1;
    jest.spyOn(Date, 'now').mockReturnValue(later);
    await resolver.resolve(7);

    expect(vpn.getConnectionLink).toHaveBeenCalledTimes(2);
  });

  it("resolves 'active' to the page's active connection", async () => {
    const { resolver, vpn } = build();

    await resolver.resolve('active');

    expect(vpn.getConnectionLink).toHaveBeenCalledWith(8);
  });

  it('keeps handing out the last good link while the panel is down, but throws if there never was one', async () => {
    const { resolver, vpn } = build();

    await resolver.resolve(7);
    vpn.getConnectionLink.mockRejectedValue(new Error('down'));
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
    vpn.getConnectionLink.mockReturnValue(new Promise(() => undefined));
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + LINK_TTL_MS + 1);

    await expect(resolver.resolve(7)).resolves.toBe('vless://a');
    expect(vpn.getConnectionLink).toHaveBeenCalledTimes(2);
  });

  it('does not ask the panel again within one TTL after a failed refresh', async () => {
    const { resolver, vpn } = build();

    await resolver.resolve(7);
    vpn.getConnectionLink.mockRejectedValue(new Error('down'));
    const start = Date.now() + LINK_TTL_MS + 1;
    const now = jest.spyOn(Date, 'now').mockReturnValue(start);

    await resolver.resolve(7);
    await new Promise((r) => setImmediate(r));
    await resolver.resolve(7);
    expect(vpn.getConnectionLink).toHaveBeenCalledTimes(2);

    now.mockReturnValue(start + LINK_TTL_MS);
    await resolver.resolve(7);
    expect(vpn.getConnectionLink).toHaveBeenCalledTimes(3);
  });
});
