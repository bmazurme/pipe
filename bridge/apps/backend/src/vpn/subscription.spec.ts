import {
  assertPublicHttpsUrl,
  parseSubscriptionBody,
  renameLink,
  subscriptionName,
} from './subscription';

const reality = (host: string, extra = '') =>
  `vless://11111111-2222-3333-4444-555555555555@${host}:443?type=tcp&security=reality&encryption=none&flow=xtls-rprx-vision&fp=firefox&sni=example.com&sid=&pbk=PUBKEY${extra}#remark`;

describe('parseSubscriptionBody', () => {
  it('reads a plain list, one link per line', () => {
    const body = `${reality('203.0.113.1')}\n${reality('203.0.113.2')}\n`;

    expect(parseSubscriptionBody(body)).toEqual({
      links: [reality('203.0.113.1'), reality('203.0.113.2')],
      unsupported: 0,
    });
  });

  it('reads the same list base64-encoded, standard or url-safe', () => {
    const list = `${reality('203.0.113.1')}\r\n${reality('203.0.113.2')}`;
    const standard = Buffer.from(list).toString('base64');
    const urlSafe = standard
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    expect(parseSubscriptionBody(standard).links).toHaveLength(2);
    expect(parseSubscriptionBody(urlSafe).links).toHaveLength(2);
  });

  it('skips comments and blank lines, and counts links it cannot run', () => {
    const body = [
      '# profile-title: PaperVPN',
      '',
      'vmess://eyJhZGQiOiJ4In0=',
      'trojan://pw@203.0.113.3:443',
      'vless://u@203.0.113.4:443?security=tls&type=tcp',
      'vless://u@203.0.113.5:443?security=reality&type=ws&pbk=k&sni=s',
      reality('203.0.113.6'),
    ].join('\n');

    expect(parseSubscriptionBody(body)).toEqual({
      links: [reality('203.0.113.6')],
      unsupported: 4,
    });
  });

  it('finds nothing in an empty answer or a page that is not a list', () => {
    expect(parseSubscriptionBody('')).toEqual({ links: [], unsupported: 0 });
    expect(
      parseSubscriptionBody('<html><body>Forbidden</body></html>'),
    ).toEqual({
      links: [],
      unsupported: 0,
    });
    expect(parseSubscriptionBody('proxies:\n  - name: x')).toEqual({
      links: [],
      unsupported: 0,
    });
  });

  it('does not take base64 that decodes to something other than links', () => {
    const notLinks = Buffer.from('hello world, no links here').toString(
      'base64',
    );

    expect(parseSubscriptionBody(notLinks).links).toEqual([]);
  });
});

describe('assertPublicHttpsUrl', () => {
  it('takes an https address with a path and a name after #', () => {
    const url = assertPublicHttpsUrl(
      'https://api.provider.example/sub/abc123#PaperVPN',
    );

    expect(url.hostname).toBe('api.provider.example');
  });

  it.each([
    ['http', 'http://api.provider.example/sub/abc'],
    ['not a URL', 'api.provider.example/sub'],
    ['vless', 'vless://u@h:443?security=reality'],
    ['localhost', 'https://localhost/sub'],
    ['a .local name', 'https://nas.local/sub'],
    ['an .internal name', 'https://svc.internal/sub'],
    ['loopback', 'https://127.0.0.1/sub'],
    ['private 10/8', 'https://10.1.2.3/sub'],
    ['private 172.16/12', 'https://172.20.0.5/sub'],
    ['private 192.168/16', 'https://192.168.50.11/sub'],
    ['link-local', 'https://169.254.169.254/latest'],
    ['carrier-grade NAT', 'https://100.64.0.1/sub'],
    ['IPv6 loopback', 'https://[::1]/sub'],
    ['IPv6 unique local', 'https://[fd12:3456::1]/sub'],
  ])('refuses %s', (_label, raw) => {
    expect(() => assertPublicHttpsUrl(raw)).toThrow();
  });

  it('lets a public IP literal through', () => {
    expect(() => assertPublicHttpsUrl('https://203.0.113.9/sub')).not.toThrow();
    expect(() => assertPublicHttpsUrl('https://172.32.0.1/sub')).not.toThrow();
  });
});

describe('subscriptionName and renameLink', () => {
  it('takes the profile name after the # of the address', () => {
    expect(subscriptionName('https://p.example/sub/x#PaperVPN')).toBe(
      'PaperVPN',
    );
    expect(subscriptionName('https://p.example/sub/x#Paper%20VPN')).toBe(
      'Paper VPN',
    );
    expect(subscriptionName('https://p.example/sub/x')).toBeNull();
    expect(subscriptionName('not a url')).toBeNull();
  });

  it("replaces the provider's remark (which may hold a # of its own) with the connection's name", () => {
    expect(renameLink('vless://u@h:443?a=b#one#two', 'Мой VPN')).toBe(
      `vless://u@h:443?a=b#${encodeURIComponent('Мой VPN')}`,
    );
    expect(renameLink('vless://u@h:443?a=b', 'x')).toBe(
      'vless://u@h:443?a=b#x',
    );
  });
});
