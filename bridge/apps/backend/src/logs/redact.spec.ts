import { redact, redactChatText, sanitizeMeta } from './redact';

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
    [
      'worker key brw_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6 rejected',
      '[redacted-bridge-key]',
    ],
    [
      'api key brk_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6 rejected',
      '[redacted-bridge-key]',
    ],
    [
      'code brn_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6 rejected',
      '[redacted-bridge-key]',
    ],
    [
      'login bre_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6 rejected',
      '[redacted-bridge-key]',
    ],
    [
      'upstream said eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijkl1234 bad',
      '[redacted-jwt]',
    ],
  ])('masks %s', (input, expected) => {
    const out = redact(input);

    expect(out).toContain(expected);
    expect(out).not.toMatch(
      /hunter2hunter2|s3cret|A1b2C3d4E5f6|eyJzdWIi|abcd1234efgh|AAEhBP0av28ZQ|abcdefghijklmnop1234/,
    );
  });

  it('masks a whole private key block', () => {
    const out = redact(
      'x -----BEGIN PRIVATE KEY-----\nAAA\nBBB\n-----END PRIVATE KEY----- y',
    );

    expect(out).toBe('x [redacted-private-key] y');
  });

  it.each(['brk_', 'brw_abc', 'version eyJ.1.2'])(
    'leaves %s untouched',
    (input) => {
      expect(redact(input)).toBe(input);
    },
  );

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

describe('redactChatText', () => {
  it.each([
    ['key sk-ant-oat01-AbCdEfGhIjKlMnOp', '[скрыто: ключ Anthropic / OpenAI]'],
    ['token ghp_abcdefghijklmnop1234', '[скрыто: токен GitHub]'],
    ['using glpat-abcdefghijklmnop1234', '[скрыто: токен GitLab]'],
    [
      'bot 1234567890:AAEhBP0av28ZQ-abcdefghijklmnopqrstuvwxyz',
      '[скрыто: токен Telegram-бота]',
    ],
    ['worker brw_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6', '[скрыто: ключ bridge]'],
    [
      'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijkl1234',
      '[скрыто: JWT]',
    ],
    ['Bearer abcdefghijklmnopqrstuvwxyz', '[скрыто: заголовок Bearer]'],
    [
      '-----BEGIN PRIVATE KEY-----\nMIIEvQ\n-----END PRIVATE KEY-----',
      '[скрыто: приватный ключ]',
    ],
    [
      'GET https://user:s3cret@example.com/x',
      '[скрыто: пароль в адресе]example.com/x',
    ],
  ])('hides %s', (input, expected) => {
    const out = redactChatText(input);

    expect(out).toContain(expected);
    expect(out).not.toMatch(/s3cret|AbCdEf|abcdefghijklmnop|A1b2C3|MIIEvQ/);
  });

  it('leaves prose and code that merely mention a token or a password untouched', () => {
    const text =
      'Почему token: refresh не работает? password=changeme, sk-короткий, user@example.com, https://example.com/a?b=c';

    expect(redactChatText(text)).toBe(text);
  });
});
