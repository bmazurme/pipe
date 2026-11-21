import { buildXrayConfig, parseVless } from './xray-config';

const LINK =
  'vless://11111111-2222-3333-4444-555555555555@vpn.example:443?security=reality&encryption=none&pbk=PUB&fp=chrome&sni=www.samsung.com&sid=ab12&type=tcp&flow=xtls-rprx-vision#name';

describe('parseVless', () => {
  it('reads a Reality link', () => {
    expect(parseVless(LINK)).toMatchObject({
      host: 'vpn.example',
      port: 443,
      uuid: '11111111-2222-3333-4444-555555555555',
      flow: 'xtls-rprx-vision',
      serverName: 'www.samsung.com',
      publicKey: 'PUB',
      shortId: 'ab12',
      fingerprint: 'chrome',
    });
  });

  it('refuses what is not a usable Reality link', () => {
    expect(() => parseVless('hello')).toThrow('not a vless:// link');
    expect(() => parseVless('https://x.example/')).toThrow('not a vless://');
    expect(() =>
      parseVless(LINK.replace('security=reality', 'security=tls')),
    ).toThrow('not security=reality');
    expect(() => parseVless(LINK.replace('type=tcp', 'type=ws'))).toThrow(
      'only tcp',
    );
    expect(() => parseVless(LINK.replace('&pbk=PUB', ''))).toThrow('"pbk"');
  });
});

describe('buildXrayConfig', () => {
  type Config = {
    inbounds: { listen: string; port: number; protocol: string }[];
    outbounds: {
      tag: string;
      streamSettings: { realitySettings: { fingerprint: string } };
    }[];
    observatory?: unknown;
    routing?: { balancers: { fallbackTag: string }[] };
  };

  it('is a plain tunnel for one link, on loopback only, with the firefox fingerprint', () => {
    const config = buildXrayConfig(parseVless(LINK), 18081) as Config;

    expect(config.inbounds).toEqual([
      { tag: 'in', listen: '127.0.0.1', port: 18081, protocol: 'http' },
    ]);
    expect(config.outbounds).toHaveLength(1);
    expect(config.outbounds[0].streamSettings.realitySettings.fingerprint).toBe(
      'firefox',
    );
    expect(config.observatory).toBeUndefined();
  });

  it('balances several links and falls back to the first', () => {
    const second = parseVless(LINK.replace('vpn.example', 'other.example'));
    const config = buildXrayConfig(
      [parseVless(LINK), second],
      18081,
      'link',
    ) as Config;

    expect(config.outbounds.map((o) => o.tag)).toEqual(['node-1', 'node-2']);
    expect(config.outbounds[0].streamSettings.realitySettings.fingerprint).toBe(
      'chrome',
    );
    expect(config.observatory).toBeDefined();
    expect(config.routing?.balancers[0].fallbackTag).toBe('node-1');
  });

  describe('with a cold standby', () => {
    type StandbyConfig = {
      outbounds: { tag: string; protocol: string; settings?: unknown }[];
      observatory: { subjectSelector: string[]; probeInterval: string };
      routing: {
        balancers: {
          tag: string;
          selector: string[];
          strategy: { type: string };
          fallbackTag?: string;
        }[];
        rules: { inboundTag: string[]; balancerTag: string }[];
      };
    };

    const standbyLink = (host: string) =>
      parseVless(LINK.replace('vpn.example', host));
    const build = () =>
      buildXrayConfig([parseVless(LINK)], 18081, 'link', [
        standbyLink('gru-1.example'),
        standbyLink('gru-2.example'),
      ]) as StandbyConfig;

    it('keeps the standby out of the probed pool: only node-* is observed and balanced', () => {
      const config = build();

      expect(config.outbounds.map((o) => o.tag)).toEqual([
        'node-1',
        'standby-1',
        'standby-2',
        'to-standby',
      ]);
      expect(config.observatory.subjectSelector).toEqual(['node-']);
      expect(config.routing.balancers[0]).toMatchObject({
        tag: 'pool',
        selector: ['node-'],
        strategy: { type: 'leastPing' },
      });
    });

    it('uses the standby only as the pool fallback, through a loopback into a second balancer that is never probed', () => {
      const config = build();

      expect(config.routing.balancers[0].fallbackTag).toBe('to-standby');
      expect(
        config.outbounds.find((o) => o.tag === 'to-standby'),
      ).toMatchObject({
        protocol: 'loopback',
        settings: { inboundTag: 'standby-in' },
      });
      expect(config.routing.balancers[1]).toMatchObject({
        tag: 'standby',
        selector: ['standby-'],
        strategy: { type: 'random' },
      });
      expect(config.routing.rules).toEqual([
        { type: 'field', inboundTag: ['standby-in'], balancerTag: 'standby' },
        { type: 'field', inboundTag: ['in'], balancerTag: 'pool' },
      ]);
    });

    it('is balanced (not the plain one-link tunnel) even for a single main link, and probes it every 30 s', () => {
      expect(build().observatory.probeInterval).toBe('30s');
    });

    it('is unchanged without a standby', () => {
      const config = buildXrayConfig([parseVless(LINK)], 18081) as {
        outbounds: unknown[];
        observatory?: unknown;
      };

      expect(config.outbounds).toHaveLength(1);
      expect(config.observatory).toBeUndefined();
    });
  });
});
