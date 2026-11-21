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
});
