import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// RFC 6238 TOTP (SHA-1, 6 digits, 30 s) — what Aegis / 2FAS / Google Authenticator all speak by default.
// No dependency on purpose: it is ~40 lines and every moving part is covered by the RFC's own test vectors.

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
// A code is accepted one step either side of "now": a phone clock that is up to ~30 s off still works.
export const TOTP_WINDOW = 1;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];

  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (const char of clean) {
    const index = BASE32.indexOf(char);

    if (index < 0) throw new Error('Not a base32 string');

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

// 20 random bytes = 160 bits, the RFC's recommended size for SHA-1.
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(
  secret: Buffer,
  counter: number,
  digits = TOTP_DIGITS,
): string {
  const message = Buffer.alloc(8);

  message.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac('sha1', secret).update(message).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];

  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function totpStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

export function totpAt(secretBase32: string, nowMs: number): string {
  return hotp(base32Decode(secretBase32), totpStep(nowMs));
}

/**
 * The step a code belongs to, or null when it matches none inside the window.
 * `lastStep` is the newest step already spent: a code from that step or an older one is refused, so a code that
 * was shoulder-surfed (or replayed from a log) cannot be used a second time.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  nowMs: number,
  lastStep: number,
): number | null {
  const given = code.replace(/\s/g, '');

  if (!/^\d{6}$/.test(given)) return null;

  const secret = base32Decode(secretBase32);
  const current = totpStep(nowMs);
  let accepted: number | null = null;

  // Every step is compared (no early exit) so the time taken does not say which step matched.
  for (
    let step = current - TOTP_WINDOW;
    step <= current + TOTP_WINDOW;
    step++
  ) {
    const expected = Buffer.from(hotp(secret, step));
    const matches = timingSafeEqual(expected, Buffer.from(given));

    if (matches && step > lastStep && (accepted === null || step > accepted)) {
      accepted = step;
    }
  }

  return accepted;
}

export function otpauthUri(
  secretBase32: string,
  account: string,
  issuer: string,
): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const query = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });

  return `otpauth://totp/${label}?${query.toString()}`;
}

// Recovery codes: 80 random bits as xxxx-xxxx-xxxx-xxxx (lower-case base32). With that much entropy a plain SHA-256
// in the database is enough — there is nothing to brute-force.
export function generateRecoveryCode(): string {
  const raw = base32Encode(randomBytes(10)).toLowerCase();

  return raw.match(/.{4}/g)!.join('-');
}

export function normalizeRecoveryCode(input: string): string | null {
  const raw = input.replace(/[\s-]/g, '').toLowerCase();

  return /^[a-z2-7]{16}$/.test(raw) ? raw.match(/.{4}/g)!.join('-') : null;
}
