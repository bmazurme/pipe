import { createHmac } from 'crypto';

import { isValidGithubSignature, safeEqual } from './webhook-signature';

const body = Buffer.from('{"a":1}');
const sign = (secret: string) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

describe('isValidGithubSignature', () => {
  it('accepts a correct signature', () => {
    expect(isValidGithubSignature('s3cret', body, sign('s3cret'))).toBe(true);
  });

  it('rejects a wrong secret, a missing header and a wrong-length header', () => {
    expect(isValidGithubSignature('s3cret', body, sign('other'))).toBe(false);
    expect(isValidGithubSignature('s3cret', body, undefined)).toBe(false);
    expect(isValidGithubSignature('s3cret', body, 'sha256=abc')).toBe(false);
  });

  it('rejects a body that was altered after signing', () => {
    expect(
      isValidGithubSignature('s3cret', Buffer.from('{"a":2}'), sign('s3cret')),
    ).toBe(false);
  });
});

describe('safeEqual', () => {
  it('compares without throwing on length mismatch', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('abc', undefined)).toBe(false);
  });
});
