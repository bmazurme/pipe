import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { setTunnelProxy, tunnelProxyUrl } from '../common/tunnel-proxy';
import type { VpnLinkResolver } from '../vpn/vpn-link-resolver.service';
import { BridgeTunnelService, type ProbeFn } from './bridge-tunnel.service';
import type { TunnelProcess } from './tunnel-process';

const PROXY = 'http://127.0.0.1:18081';

function setup(
  options: {
    env?: Record<string, string>;
    links?: string[] | Error;
    standby?: string[];
  } = {},
) {
  const apply = jest.fn<Promise<string | null>, [string[], string[]]>(
    async (links) => (links.length ? PROXY : null),
  );
  const process = {
    apply,
    stop: jest.fn(),
    proxyUrl: PROXY,
    isMissing: false,
    linkCount: 0,
    standbyCount: 0,
  };
  const resolveMany = jest.fn(async () => {
    if (options.links instanceof Error) throw options.links;

    return options.links ?? ['vless://a'];
  });
  const resolveStandby = jest.fn(async () => options.standby ?? []);
  const record = jest.fn<Promise<void>, [{ event: string }]>(
    async () => undefined,
  );
  const service = new BridgeTunnelService(
    { get: (key: string) => options.env?.[key] } as unknown as ConfigService,
    { resolveMany, resolveStandby } as unknown as VpnLinkResolver,
    { record } as never,
    process as unknown as TunnelProcess,
  );

  return { service, process, apply, resolveMany, record };
}

const answer =
  (byHost: Record<string, number | Error>): ProbeFn =>
  async (url) => {
    const host = new URL(url).host;
    const result = byHost[host] ?? 200;

    if (result instanceof Error) throw result;

    return result;
  };

describe('BridgeTunnelService', () => {
  afterEach(() => setTunnelProxy(null));

  it('hands the tunnel the cold standby links next to the active ones, asked for after them', async () => {
    const { service, apply } = setup({ standby: ['vless://spare'] });

    service.probe = answer({});
    await service.check();

    expect(apply).toHaveBeenCalledWith(['vless://a'], ['vless://spare']);
  });

  it('uses the tunnel once Telegram answers through it, and says so once', async () => {
    const { service, apply, record } = setup();

    service.probe = answer({});
    await service.check();
    await service.check();

    expect(apply).toHaveBeenCalledWith(['vless://a'], []);
    expect(tunnelProxyUrl()).toBe(PROXY);
    expect(service.status()).toMatchObject({ mode: 'on', inUse: true });
    expect(service.status().checks.map((c) => [c.key, c.ok])).toEqual([
      ['telegram', true],
      ['github', true],
    ]);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'tunnel.up' }),
    );
  });

  it('does not use a tunnel that is up but cannot reach Telegram (a wrong certificate, a hang)', async () => {
    const { service, record } = setup();

    service.probe = answer({
      'api.telegram.org': Object.assign(new Error('x'), {
        code: 'ERR_TLS_CERT_ALTNAME_INVALID',
      }),
    });
    await service.check();

    expect(tunnelProxyUrl()).toBeUndefined();
    expect(service.status().inUse).toBe(false);
    expect(
      service.status().checks.find((c) => c.key === 'telegram'),
    ).toMatchObject({
      ok: false,
      error: 'ERR_TLS_CERT_ALTNAME_INVALID',
    });
    // it was never in use, so there is no change to announce
    expect(record).not.toHaveBeenCalled();
  });

  it('stops using the tunnel when it stops working, and starts again when it recovers', async () => {
    const { service, record } = setup();

    service.probe = answer({});
    await service.check();
    expect(tunnelProxyUrl()).toBe(PROXY);

    service.probe = answer({ 'api.telegram.org': new Error('timeout') });
    for (let i = 0; i < 3; i++) await service.check();
    expect(tunnelProxyUrl()).toBeUndefined();

    service.probe = answer({});
    await service.check();
    expect(tunnelProxyUrl()).toBe(PROXY);

    expect(record.mock.calls.map((c) => c[0].event)).toEqual([
      'tunnel.up',
      'tunnel.down',
      'tunnel.up',
    ]);
  });

  it('keeps the tunnel through 2 failed probes and drops it on the 3rd', async () => {
    const { service, record } = setup();

    service.probe = answer({});
    await service.check();
    service.probe = answer({ 'api.telegram.org': new Error('timeout') });
    await service.check();
    await service.check();

    expect(service.status()).toMatchObject({ inUse: true, failures: 2 });
    expect(tunnelProxyUrl()).toBe(PROXY);
    expect(record.mock.calls.map((c) => c[0].event)).toEqual(['tunnel.up']);

    await service.check();

    expect(service.status().inUse).toBe(false);
    expect(record.mock.calls.map((c) => c[0].event)).toEqual([
      'tunnel.up',
      'tunnel.down',
    ]);
  });

  it('resets the failure streak on a successful probe', async () => {
    const { service, record } = setup();
    const fail = answer({ 'api.telegram.org': new Error('timeout') });

    service.probe = answer({});
    await service.check();

    for (const probe of [fail, fail, answer({}), fail, fail]) {
      service.probe = probe;
      await service.check();
    }

    expect(service.status()).toMatchObject({ inUse: true, failures: 2 });
    expect(record.mock.calls.map((c) => c[0].event)).toEqual(['tunnel.up']);
  });

  it('counts a 5xx as a failure, and any other answer as a path', async () => {
    const { service } = setup();

    service.probe = answer({ 'api.telegram.org': 502, 'api.github.com': 403 });
    await service.check();

    const checks = service.status().checks;

    expect(checks.find((c) => c.key === 'telegram')).toMatchObject({
      ok: false,
      error: 'HTTP 502',
    });
    expect(checks.find((c) => c.key === 'github')?.ok).toBe(true);
    expect(service.status().inUse).toBe(false);
  });

  it('stops the tunnel when nothing is active on the VPN page', async () => {
    const { service, apply } = setup({
      links: new NotFoundException('No active VPN connection'),
    });

    service.probe = answer({});
    await service.check();

    expect(apply).toHaveBeenCalledWith([], []);
    expect(service.status().inUse).toBe(false);
    expect(tunnelProxyUrl()).toBeUndefined();
  });

  it('leaves the running tunnel alone when the panel cannot be asked', async () => {
    const { service, apply, process } = setup();

    service.probe = answer({});
    await service.check();
    expect(service.status().inUse).toBe(true);

    process.linkCount = 1;
    (
      service as unknown as { resolver: { resolveMany: jest.Mock } }
    ).resolver.resolveMany.mockRejectedValue(
      new ServiceUnavailableException('panel down'),
    );
    apply.mockClear();
    await service.check();

    expect(apply).not.toHaveBeenCalled();
    expect(service.status().inUse).toBe(true);
  });

  it('can be switched off, and then does nothing', async () => {
    const { service, apply, resolveMany } = setup({
      env: { BRIDGE_TUNNEL: 'off' },
    });

    service.onModuleInit();
    await service.check();

    expect(apply).not.toHaveBeenCalled();
    expect(resolveMany).not.toHaveBeenCalled();
    expect(service.status()).toMatchObject({ mode: 'off', inUse: false });
  });

  it('withdraws the proxy when the module is destroyed', async () => {
    const { service, process } = setup();

    service.probe = answer({});
    await service.check();
    service.onModuleDestroy();

    expect(tunnelProxyUrl()).toBeUndefined();
    expect(process.stop).toHaveBeenCalled();
  });

  it('reports whether Telegram is reachable and whether another channel is set up', async () => {
    const telegram = {
      health: () => ({
        down: true,
        failingSince: new Date('2026-11-21T09:00:00Z'),
        lastError: 'timeout',
      }),
    };
    const fallback = {
      isConfigured: () => true,
      channels: () => [{ name: 'webhook', target: 'ntfy.sh' }],
    };
    const service = new BridgeTunnelService(
      { get: () => undefined } as unknown as ConfigService,
      { resolveMany: jest.fn() } as unknown as VpnLinkResolver,
      undefined,
      {
        apply: jest.fn(),
        stop: jest.fn(),
        proxyUrl: PROXY,
        isMissing: false,
        linkCount: 0,
      } as unknown as TunnelProcess,
      telegram as never,
      fallback as never,
    );

    expect(service.status().telegram).toEqual({
      down: true,
      since: '2026-11-21T09:00:00.000Z',
      error: 'timeout',
    });
    expect(service.status().fallback).toEqual({
      configured: true,
      channels: [{ name: 'webhook', target: 'ntfy.sh' }],
    });
  });
});
