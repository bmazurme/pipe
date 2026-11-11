import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildXrayConfig, DEFAULT_FINGERPRINT, parseVless, POOL_TAG_PREFIX, PROBE_URL } from './vless.js';

const LINK =
  'vless://3f1c2d4e-0000-4000-8000-000000000001@vpn.example.com:8443?security=reality&type=tcp&pbk=PUB&sni=www.example.org&fp=firefox&sid=ab12&flow=xtls-rprx-vision&spx=%2F#node';

describe('parseVless', () => {
  it('reads the server, the user and the Reality parameters', () => {
    assert.deepEqual(parseVless(LINK), {
      host: 'vpn.example.com',
      port: 8443,
      uuid: '3f1c2d4e-0000-4000-8000-000000000001',
      flow: 'xtls-rprx-vision',
      encryption: 'none',
      serverName: 'www.example.org',
      fingerprint: 'firefox',
      publicKey: 'PUB',
      shortId: 'ab12',
      spiderX: '/',
    });
  });

  it('defaults: port 443, fingerprint chrome, no flow', () => {
    const params = parseVless('vless://u@h.example?security=reality&pbk=k&sni=s');

    assert.equal(params.port, 443);
    assert.equal(params.fingerprint, 'chrome');
    assert.equal('flow' in params, false);
  });

  it('refuses what a worker cannot run', () => {
    assert.throws(() => parseVless('hello'), /not a vless/);
    assert.throws(() => parseVless('vmess://u@h:1?security=reality&pbk=k&sni=s'), /not a vless/);
    assert.throws(() => parseVless('vless://u@h:1?security=tls&pbk=k&sni=s'), /reality/);
    assert.throws(() => parseVless('vless://u@h:1?security=reality&type=ws&pbk=k&sni=s'), /tcp/);
    assert.throws(() => parseVless('vless://u@h:1?security=reality&sni=s'), /"pbk"/);
  });
});

describe('buildXrayConfig', () => {
  it('is an HTTP proxy on loopback and one VLESS+Reality outbound', () => {
    const config = buildXrayConfig(parseVless(LINK), 18080) as {
      inbounds: { listen: string; port: number; protocol: string }[];
      outbounds: { protocol: string; settings: { vnext: { address: string; port: number; users: { id: string; flow?: string }[] }[] }; streamSettings: { security: string; realitySettings: { publicKey: string } } }[];
    };

    assert.deepEqual(config.inbounds, [{ tag: 'in', listen: '127.0.0.1', port: 18080, protocol: 'http' }]);
    assert.equal(config.outbounds[0].protocol, 'vless');
    assert.equal(config.outbounds[0].settings.vnext[0].address, 'vpn.example.com');
    assert.equal(config.outbounds[0].settings.vnext[0].port, 8443);
    assert.equal(config.outbounds[0].settings.vnext[0].users[0].flow, 'xtls-rprx-vision');
    assert.equal(config.outbounds[0].streamSettings.security, 'reality');
    assert.equal(config.outbounds[0].streamSettings.realitySettings.publicKey, 'PUB');
  });

  const fingerprintOf = (config: object) =>
    (config as { outbounds: { streamSettings: { realitySettings: { fingerprint: string } } }[] }).outbounds[0].streamSettings.realitySettings.fingerprint;

  it('uses firefox whatever fingerprint the link carries (chrome hangs most connections on this network)', () => {
    assert.equal(DEFAULT_FINGERPRINT, 'firefox');
    // LINK carries fp=firefox; one that says chrome must not win
    const chromeLink = LINK.replace('fp=firefox', 'fp=chrome');

    assert.equal(fingerprintOf(buildXrayConfig(parseVless(chromeLink), 18080)), 'firefox');
  });

  it('can be told another fingerprint, or to keep the link\'s own', () => {
    const chromeLink = LINK.replace('fp=firefox', 'fp=chrome');

    assert.equal(fingerprintOf(buildXrayConfig(parseVless(chromeLink), 18080, 'safari')), 'safari');
    assert.equal(fingerprintOf(buildXrayConfig(parseVless(chromeLink), 18080, 'link')), 'chrome');
  });
});

describe('buildXrayConfig: a pool of links', () => {
  const OTHER = 'vless://3f1c2d4e-0000-4000-8000-000000000002@other.example.net:443?security=reality&type=tcp&pbk=PUB2&sni=www.example.com&fp=firefox&sid=cd34';
  const THIRD = 'vless://3f1c2d4e-0000-4000-8000-000000000003@third.example.org:443?security=reality&type=tcp&pbk=PUB3&sni=www.example.net&fp=firefox&sid=';

  type Pool = {
    inbounds: { tag: string }[];
    outbounds: { tag: string; settings: { vnext: { address: string }[] } }[];
    observatory?: { subjectSelector: string[]; probeUrl: string; probeInterval: string };
    routing?: { balancers: { tag: string; selector: string[]; strategy: { type: string }; fallbackTag: string }[]; rules: { inboundTag: string[]; balancerTag: string }[] };
  };

  it('is a plain tunnel for one link: one outbound, no probing, no balancer', () => {
    const config = buildXrayConfig([parseVless(LINK)], 18080) as Pool;

    assert.equal(config.outbounds.length, 1);
    assert.equal(config.outbounds[0].tag, `${POOL_TAG_PREFIX}1`);
    assert.equal(config.observatory, undefined);
    assert.equal(config.routing, undefined);
  });

  it('is the same plain tunnel for a single params object as before', () => {
    assert.deepEqual(buildXrayConfig(parseVless(LINK), 18080), buildXrayConfig([parseVless(LINK)], 18080));
  });

  it('gives every link of a pool an outbound, in order, and keeps each link\'s own server', () => {
    const config = buildXrayConfig([parseVless(LINK), parseVless(OTHER), parseVless(THIRD)], 18080) as Pool;

    assert.deepEqual(config.outbounds.map((outbound) => outbound.tag), ['node-1', 'node-2', 'node-3']);
    assert.deepEqual(config.outbounds.map((outbound) => outbound.settings.vnext[0].address), ['vpn.example.com', 'other.example.net', 'third.example.org']);
  });

  it('probes the exits through themselves and sends everything from the inbound to the fastest one', () => {
    const config = buildXrayConfig([parseVless(LINK), parseVless(OTHER)], 18080) as Pool;

    assert.deepEqual(config.observatory?.subjectSelector, ['node-']);
    assert.equal(config.observatory?.probeUrl, PROBE_URL);
    assert.equal(config.observatory?.probeInterval, '1m');
    assert.deepEqual(config.routing?.balancers, [{ tag: 'pool', selector: ['node-'], strategy: { type: 'leastPing' }, fallbackTag: 'node-1' }]);
    assert.deepEqual(config.routing?.rules, [{ type: 'field', inboundTag: [config.inbounds[0].tag], balancerTag: 'pool' }]);
  });

  it('applies the fingerprint setting to every outbound of the pool', () => {
    const config = buildXrayConfig([parseVless(LINK), parseVless(OTHER.replace('fp=firefox', 'fp=chrome'))], 18080) as {
      outbounds: { streamSettings: { realitySettings: { fingerprint: string } } }[];
    };

    assert.deepEqual(config.outbounds.map((outbound) => outbound.streamSettings.realitySettings.fingerprint), ['firefox', 'firefox']);
  });

  it('keeps the loopback-only inbound whatever the pool', () => {
    const config = buildXrayConfig([parseVless(LINK), parseVless(OTHER)], 18080) as { inbounds: { listen: string; port: number }[] };

    assert.deepEqual(config.inbounds.map((inbound) => [inbound.listen, inbound.port]), [['127.0.0.1', 18080]]);
  });
});
