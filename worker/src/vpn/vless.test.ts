import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildXrayConfig, DEFAULT_FINGERPRINT, parseVless } from './vless.js';

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

    assert.deepEqual(config.inbounds, [{ listen: '127.0.0.1', port: 18080, protocol: 'http' }]);
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
