import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { chooseRoute, isPrivateHost, RouteUnavailableError } from './routing.js';

const PROXY = 'http://127.0.0.1:18080';

describe('isPrivateHost', () => {
  it('knows the private ranges, local names and single-label hosts', () => {
    for (const host of ['localhost', '127.0.0.1', '10.1.2.3', '172.16.0.5', '172.31.255.1', '192.168.50.35', '169.254.1.1', '100.100.1.1', 'mac.local', 'nas.lan', 'ollama', '[::1]', 'fd12:3456::1', 'fe80::1']) {
      assert.equal(isPrivateHost(host), true, host);
    }
  });

  it('treats public names and addresses as public', () => {
    for (const host of ['api.openai.com', 'generativelanguage.googleapis.com', 'llm.api.cloud.yandex.net', '8.8.8.8', '172.32.0.1', '172.15.0.1', '100.63.0.1', '100.128.0.1', '2001:db8::1', '']) {
      assert.equal(isPrivateHost(host), false, host);
    }
  });
});

describe('chooseRoute', () => {
  it('auto: a public address goes through the proxy when there is one, direct when there is not', () => {
    assert.equal(chooseRoute({ url: 'https://api.openai.com/v1', proxyUrl: PROXY }).via, 'vpn');
    assert.equal(chooseRoute({ url: 'https://api.openai.com/v1', proxyUrl: PROXY }).proxyUrl, PROXY);
    assert.equal(chooseRoute({ url: 'https://api.openai.com/v1' }).via, 'direct');
  });

  it('auto: a private address goes direct even with a proxy', () => {
    const decision = chooseRoute({ url: 'http://192.168.50.35:11434/v1', proxyUrl: PROXY });

    assert.equal(decision.via, 'direct');
    assert.equal(decision.proxyUrl, undefined);
  });

  it('a key without a route behaves as auto', () => {
    assert.equal(chooseRoute({ url: 'https://api.openai.com/v1', route: null, proxyUrl: PROXY }).via, 'vpn');
  });

  it('direct: never uses the proxy, whatever the address', () => {
    assert.equal(chooseRoute({ url: 'https://llm.api.cloud.yandex.net/v1', route: 'direct', proxyUrl: PROXY }).via, 'direct');
  });

  it('vpn: always through the proxy, even to a private address; refuses to go around it', () => {
    assert.equal(chooseRoute({ url: 'http://10.0.0.5:8080/v1', route: 'vpn', proxyUrl: PROXY }).via, 'vpn');
    assert.throws(() => chooseRoute({ url: 'https://generativelanguage.googleapis.com/v1beta/openai', route: 'vpn' }), RouteUnavailableError);
    assert.throws(() => chooseRoute({ url: 'https://x.example', route: 'vpn', proxyUrl: '  ' }), RouteUnavailableError);
  });

  it('the reason never contains the address', () => {
    const decision = chooseRoute({ url: 'http://secret-host.local:9/v1', proxyUrl: PROXY });

    assert.ok(!decision.reason.includes('secret-host'));
  });
});
