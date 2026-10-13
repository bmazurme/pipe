import { resolveTrustProxy } from './trust-proxy';

describe('resolveTrustProxy', () => {
  it('keeps trusting only loopback by default', () => {
    expect(resolveTrustProxy(undefined)).toBe('loopback');
    expect(resolveTrustProxy('')).toBe('loopback');
    expect(resolveTrustProxy(' , ')).toBe('loopback');
  });

  it('accepts a single value as is', () => {
    expect(resolveTrustProxy('uniquelocal')).toBe('uniquelocal');
    expect(resolveTrustProxy(' 10.0.0.0/8 ')).toBe('10.0.0.0/8');
  });

  it('splits a comma-separated list', () => {
    expect(resolveTrustProxy('loopback, 10.0.0.0/8')).toEqual([
      'loopback',
      '10.0.0.0/8',
    ]);
  });
});
