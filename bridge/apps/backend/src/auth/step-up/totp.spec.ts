import {
  base32Decode,
  base32Encode,
  generateRecoveryCode,
  hotp,
  normalizeRecoveryCode,
  otpauthUri,
  totpAt,
  totpStep,
  verifyTotp,
} from './totp';

// RFC 6238 appendix B, SHA-1 secret "12345678901234567890" (8-digit vectors, the last 6 digits are the 6-digit code).
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('totp', () => {
  it('matches the RFC 6238 test vectors', () => {
    expect(totpAt(RFC_SECRET, 59_000)).toBe('287082');
    expect(totpAt(RFC_SECRET, 1_111_111_109_000)).toBe('081804');
    expect(totpAt(RFC_SECRET, 1_234_567_890_000)).toBe('005924');
    expect(totpAt(RFC_SECRET, 2_000_000_000_000)).toBe('279037');
  });

  it('matches the RFC 4226 HOTP vector', () => {
    expect(hotp(Buffer.from('12345678901234567890'), 0)).toBe('755224');
    expect(hotp(Buffer.from('12345678901234567890'), 9)).toBe('520489');
  });

  it('round-trips base32', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);

    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
    expect(base32Decode('mfrg gzdf=')).toEqual(Buffer.from('abcde'));
    expect(() => base32Decode('not*base32')).toThrow();
  });

  describe('verifyTotp', () => {
    const now = 1_234_567_890_000;
    const step = totpStep(now);

    it('accepts the current code and returns its step', () => {
      expect(verifyTotp(RFC_SECRET, '005924', now, 0)).toBe(step);
    });

    it('accepts one step of clock drift either way, not two', () => {
      const earlier = totpAt(RFC_SECRET, now - 30_000);
      const later = totpAt(RFC_SECRET, now + 30_000);
      const tooOld = totpAt(RFC_SECRET, now - 60_000);

      expect(verifyTotp(RFC_SECRET, earlier, now, 0)).toBe(step - 1);
      expect(verifyTotp(RFC_SECRET, later, now, 0)).toBe(step + 1);
      expect(verifyTotp(RFC_SECRET, tooOld, now, 0)).toBeNull();
    });

    it('refuses a code from a step that was already used', () => {
      expect(verifyTotp(RFC_SECRET, '005924', now, step)).toBeNull();
      // the previous step is also spent once a newer one was
      const earlier = totpAt(RFC_SECRET, now - 30_000);

      expect(verifyTotp(RFC_SECRET, earlier, now, step)).toBeNull();
    });

    it('refuses wrong, short and non-numeric codes', () => {
      expect(verifyTotp(RFC_SECRET, '000000', now, 0)).toBeNull();
      expect(verifyTotp(RFC_SECRET, '12345', now, 0)).toBeNull();
      expect(verifyTotp(RFC_SECRET, '12345a', now, 0)).toBeNull();
      expect(verifyTotp(RFC_SECRET, '', now, 0)).toBeNull();
    });

    it('ignores spaces typed into the code', () => {
      expect(verifyTotp(RFC_SECRET, '005 924', now, 0)).toBe(step);
    });
  });

  it('builds an otpauth URI an authenticator app understands', () => {
    const uri = otpauthUri('ABCDEF234567', 'me@example.com', 'pipe bridge');

    expect(
      uri.startsWith('otpauth://totp/pipe%20bridge:me%40example.com?'),
    ).toBe(true);
    expect(uri).toContain('secret=ABCDEF234567');
    expect(uri).toContain('issuer=pipe+bridge');
    expect(uri).toContain('period=30');
  });

  it('makes recovery codes that normalize back to themselves', () => {
    const code = generateRecoveryCode();

    expect(code).toMatch(/^([a-z2-7]{4}-){3}[a-z2-7]{4}$/);
    expect(normalizeRecoveryCode(code)).toBe(code);
    expect(normalizeRecoveryCode(code.toUpperCase().replace(/-/g, ' '))).toBe(
      code,
    );
    expect(normalizeRecoveryCode('too-short')).toBeNull();
    expect(generateRecoveryCode()).not.toBe(code);
  });
});
