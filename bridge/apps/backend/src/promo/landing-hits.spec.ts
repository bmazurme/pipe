import {
  dayKey,
  deviceOf,
  hostOf,
  isBotUserAgent,
  parseHit,
  visitorId,
} from './landing-hits';

const OWN = 'proto450.ntlstl.dev';

describe('parseHit', () => {
  it('reads a page view with its source and campaign', () => {
    expect(
      parseHit(
        {
          t: 'view',
          l: 'en',
          r: 'https://www.google.com/search?q=boat',
          us: 'telegram',
          um: 'post',
          uc: 'launch_1',
        },
        OWN,
      ),
    ).toEqual({
      kind: 'view',
      lang: 'en',
      referrer: 'google.com',
      utmSource: 'telegram',
      utmMedium: 'post',
      utmCampaign: 'launch_1',
      target: null,
      section: null,
    });
  });

  it('keeps only the host of a click target and the section it was in', () => {
    const hit = parseHit(
      { t: 'click', to: 'https://t.me/+secretInvite', s: 'hero' },
      OWN,
    );

    expect(hit).toMatchObject({
      kind: 'click',
      target: 't.me',
      section: 'hero',
    });
  });

  it('drops a referrer that is the landing itself and an unknown language', () => {
    expect(
      parseHit({ t: 'view', r: `https://${OWN}/`, l: 'de' }, OWN),
    ).toMatchObject({ referrer: null, lang: null });
  });

  it('refuses anything that is not an event of this page', () => {
    expect(parseHit(null, OWN)).toBeNull();
    expect(parseHit('view', OWN)).toBeNull();
    expect(parseHit({ t: 'purchase' }, OWN)).toBeNull();
    expect(parseHit({}, OWN)).toBeNull();
  });

  it('cleans campaign tags and drops a section that is not an id', () => {
    const hit = parseHit(
      { t: 'view', us: '<script>x</script>', s: 'a b' },
      OWN,
    );

    expect(hit?.utmSource).toBe('scriptxscript');
    expect(hit?.section).toBeNull();
  });

  it('cuts overlong values', () => {
    expect(
      parseHit({ t: 'view', uc: 'x'.repeat(500) }, OWN)?.utmCampaign,
    ).toHaveLength(80);
  });
});

describe('hostOf', () => {
  it('lowercases, drops www and refuses non-http addresses', () => {
    expect(hostOf('HTTPS://WWW.Example.COM/a?b=1')).toBe('example.com');
    expect(hostOf('javascript:alert(1)')).toBeNull();
    expect(hostOf('not a url')).toBeNull();
    expect(hostOf(undefined)).toBeNull();
  });
});

describe('user agents', () => {
  it('tells bots from browsers', () => {
    expect(isBotUserAgent(undefined)).toBe(true);
    expect(isBotUserAgent('Googlebot/2.1')).toBe(true);
    expect(isBotUserAgent('HeadlessChrome/120')).toBe(true);
    expect(
      isBotUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
      ),
    ).toBe(false);
  });

  it('classifies the device', () => {
    expect(
      deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148'),
    ).toBe('mobile');
    expect(
      deviceOf('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari'),
    ).toBe('mobile');
    expect(deviceOf('Mozilla/5.0 (Linux; Android 13; SM-X700) Safari')).toBe(
      'tablet',
    );
    expect(deviceOf('Mozilla/5.0 (iPad; CPU OS 17_0)')).toBe('tablet');
    expect(deviceOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(
      'desktop',
    );
  });
});

describe('visitorId and dayKey', () => {
  it('is stable within a day and changes with the day, the address, the browser and the secret', () => {
    const base = visitorId('s', '2026-11-20', '1.2.3.4', 'UA');

    expect(base).toMatch(/^[0-9a-f]{16}$/);
    expect(visitorId('s', '2026-11-20', '1.2.3.4', 'UA')).toBe(base);
    expect(visitorId('s', '2026-11-21', '1.2.3.4', 'UA')).not.toBe(base);
    expect(visitorId('s', '2026-11-20', '1.2.3.5', 'UA')).not.toBe(base);
    expect(visitorId('s', '2026-11-20', '1.2.3.4', 'UA2')).not.toBe(base);
    expect(visitorId('t', '2026-11-20', '1.2.3.4', 'UA')).not.toBe(base);
  });

  it('cuts the day at Moscow midnight', () => {
    expect(dayKey(new Date('2026-11-20T20:59:59Z'))).toBe('2026-11-20');
    expect(dayKey(new Date('2026-11-20T21:00:00Z'))).toBe('2026-11-21');
  });
});
