import { describeVless, parseVlessLink } from './vless-link';

const LINK =
  'vless://3f1c2d4e-0000-4000-8000-000000000001@vpn.example.com:8443?security=reality&type=tcp&pbk=PUBKEY&sni=www.example.org&fp=firefox&sid=ab12&flow=xtls-rprx-vision#node';

describe('parseVlessLink', () => {
  it('takes a Reality link and reports the server', () => {
    expect(parseVlessLink(LINK)).toEqual({
      host: 'vpn.example.com',
      port: 8443,
    });
  });

  it('defaults the port to 443 and tcp as the transport', () => {
    expect(
      parseVlessLink('vless://u@h.example?security=reality&pbk=k&sni=s'),
    ).toEqual({ host: 'h.example', port: 443 });
  });

  it.each([
    ['not a link', 'это не ссылка'],
    ['another scheme', 'vmess://u@h:1?security=reality&pbk=k&sni=s'],
    ['no uuid', 'vless://h.example:443?security=reality&pbk=k&sni=s'],
    ['not reality', 'vless://u@h:1?security=tls&pbk=k&sni=s'],
    ['other transport', 'vless://u@h:1?security=reality&type=ws&pbk=k&sni=s'],
    ['no public key', 'vless://u@h:1?security=reality&sni=s'],
    ['no sni', 'vless://u@h:1?security=reality&pbk=k'],
  ])('refuses %s', (_name, link) => {
    expect(() => parseVlessLink(link)).toThrow();
  });
});

describe('describeVless', () => {
  it('is host:port for a good link and null for nothing or garbage', () => {
    expect(describeVless(LINK)).toBe('vpn.example.com:8443');
    expect(describeVless(null)).toBeNull();
    expect(describeVless('')).toBeNull();
    expect(describeVless('garbage')).toBeNull();
  });
});
