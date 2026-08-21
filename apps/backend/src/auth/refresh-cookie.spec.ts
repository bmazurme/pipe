import {
  LEGACY_REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  readCookieValues,
} from './refresh-cookie';

describe('refresh cookie', () => {
  it('does not reuse the name the sibling apps set on .ntlstl.dev', () => {
    // The whole point of the rename: notes/tools/rain publish
    // `refreshToken` for the parent domain, which this API also receives.
    expect(REFRESH_COOKIE_NAME).not.toBe(LEGACY_REFRESH_COOKIE_NAME);
  });

  describe('readCookieValues', () => {
    it('returns nothing when the header is absent or has no match', () => {
      expect(readCookieValues(undefined, 'a')).toEqual([]);
      expect(readCookieValues('other=1; another=2', 'a')).toEqual([]);
    });

    it('reads a single value', () => {
      expect(readCookieValues('a=1; b=2', 'a')).toEqual(['1']);
    });

    // This is the case req.cookies collapses, and the reason a valid cookie
    // could sit in the header while the request still 401'd.
    it('returns every duplicate, in header order', () => {
      expect(readCookieValues('t=foreign; other=x; t=mine', 't')).toEqual([
        'foreign',
        'mine',
      ]);
    });

    it('matches the name exactly rather than by prefix or suffix', () => {
      expect(readCookieValues('xt=1; tx=2; t=3', 't')).toEqual(['3']);
    });

    it('tolerates padding and value-internal "=" (JWTs are base64)', () => {
      expect(readCookieValues('  t = a.b.c==  ', 't')).toEqual(['a.b.c==']);
    });

    it('decodes percent-encoding, and keeps a malformed escape verbatim', () => {
      expect(readCookieValues('t=a%20b', 't')).toEqual(['a b']);
      expect(readCookieValues('t=100%', 't')).toEqual(['100%']);
    });

    it('skips empty values and valueless segments', () => {
      expect(readCookieValues('t=; t=real; flag', 't')).toEqual(['real']);
    });

    it('caps how many candidates it will hand back', () => {
      const header = Array.from({ length: 12 }, (_, i) => `t=v${i}`).join('; ');

      expect(readCookieValues(header, 't')).toHaveLength(5);
    });
  });
});
