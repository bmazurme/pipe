import { redact, sanitizeMeta } from './redact';

describe('redact', () => {
  it.each([
    ['Authorization failed for Bearer abcdef1234567890', 'Bearer [redacted]'],
    ['key sk-ant-oat01-AbCdEfGhIjKlMnOp rejected', '[redacted-key]'],
    ['token ghp_abcdefghijklmnop1234 invalid', '[redacted-token]'],
    ['using glpat-abcdefghijklmnop1234', '[redacted-token]'],
    [
      'bot 1234567890:AAEhBP0av28ZQ-abcdefghijklmnopqrstuvwxyz failed',
      '[redacted-bot-token]',
    ],
    ['password=hunter2hunter2 in config', 'password=[redacted]'],
    ['{"api_key":"abcd1234efgh"}', '"api_key":"[redacted]'],
    ['GET https://user:s3cret@example.com/x', 'https://[redacted]@example.com'],
  ])('masks %s', (input, expected) => {
    const out = redact(input);

    expect(out).toContain(expected);
    expect(out).not.toMatch(
      /hunter2hunter2|s3cret|abcd1234efgh|AAEhBP0av28ZQ|abcdefghijklmnop1234/,
    );
  });

  it('masks a whole private key block', () => {
    const out = redact(
      'x -----BEGIN PRIVATE KEY-----\nAAA\nBBB\n-----END PRIVATE KEY----- y',
    );

    expect(out).toBe('x [redacted-private-key] y');
  });

  it('leaves ordinary text alone', () => {
    expect(redact('Job 5 failed after 12s: model returned no message')).toBe(
      'Job 5 failed after 12s: model returned no message',
    );
  });
});

describe('sanitizeMeta', () => {
  it('keeps small scalar values and drops undefined', () => {
    expect(
      sanitizeMeta({ jobId: 5, ok: false, none: null, skip: undefined }),
    ).toBe('{"jobId":5,"ok":false,"none":null}');
  });

  it('stringifies, redacts and clips non-scalars', () => {
    const json = sanitizeMeta({
      error: 'x'.repeat(1000) + ' Bearer abcdef1234567890',
      obj: { a: 1 },
    }) as string;
    const parsed = JSON.parse(json);

    expect(parsed.error.length).toBeLessThanOrEqual(300);
    expect(parsed.obj).toBe('[object Object]');
  });

  it('returns null for empty or missing meta', () => {
    expect(sanitizeMeta(undefined)).toBeNull();
    expect(sanitizeMeta({})).toBeNull();
  });
});
