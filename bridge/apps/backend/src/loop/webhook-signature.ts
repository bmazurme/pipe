import { createHmac, timingSafeEqual } from 'crypto';

// GitHub signs the raw request body: `X-Hub-Signature-256: sha256=<hex hmac>`.
export function isValidGithubSignature(
  secret: string,
  rawBody: Buffer,
  header: string | undefined,
): boolean {
  if (!header) {
    return false;
  }

  const expected = Buffer.from(
    `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`,
  );
  const received = Buffer.from(header);

  // timingSafeEqual throws on a length mismatch, which would turn a bad
  // header into a 500 instead of a clean rejection.
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

export function safeEqual(a: string, b: string | undefined): boolean {
  if (b === undefined) {
    return false;
  }

  const left = Buffer.from(a);
  const right = Buffer.from(b);

  return left.length === right.length && timingSafeEqual(left, right);
}
