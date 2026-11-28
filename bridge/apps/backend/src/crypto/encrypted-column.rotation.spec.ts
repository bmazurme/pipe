import { randomBytes } from 'node:crypto';

import {
  currentKeyId,
  decryptValue,
  encryptedColumn,
  encryptValue,
  keyIdOf,
} from './encrypted-column.transformer';

const SAVED = {
  v1: process.env.CREDENTIALS_ENC_KEY,
  v2: process.env.CREDENTIALS_ENC_KEY_V2,
  current: process.env.CREDENTIALS_ENC_KEY_CURRENT,
};

describe('encrypted column key rotation (S11)', () => {
  beforeEach(() => {
    process.env.CREDENTIALS_ENC_KEY = randomBytes(32).toString('base64');
    process.env.CREDENTIALS_ENC_KEY_V2 = randomBytes(32).toString('base64');
    delete process.env.CREDENTIALS_ENC_KEY_CURRENT;
  });

  afterAll(() => {
    for (const [name, value] of [
      ['CREDENTIALS_ENC_KEY', SAVED.v1],
      ['CREDENTIALS_ENC_KEY_V2', SAVED.v2],
      ['CREDENTIALS_ENC_KEY_CURRENT', SAVED.current],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('writes under v1 until a rotation is started', () => {
    expect(currentKeyId()).toBe('v1');
    expect(keyIdOf(encryptedColumn.to('secret') as string)).toBe('v1');
  });

  it('writes new values under the key CREDENTIALS_ENC_KEY_CURRENT names, and still reads the old ones', () => {
    const old = encryptedColumn.to('old-secret') as string;

    process.env.CREDENTIALS_ENC_KEY_CURRENT = 'v2';

    const fresh = encryptedColumn.to('new-secret') as string;

    expect(keyIdOf(old)).toBe('v1');
    expect(keyIdOf(fresh)).toBe('v2');
    expect(encryptedColumn.from(old)).toBe('old-secret');
    expect(encryptedColumn.from(fresh)).toBe('new-secret');
  });

  it('refuses a current key id that is not v<N> instead of writing under a key nobody has', () => {
    process.env.CREDENTIALS_ENC_KEY_CURRENT = 'new';

    expect(() => currentKeyId()).toThrow(/must look like/);
    expect(() => encryptedColumn.to('x')).toThrow(/must look like/);
  });

  it('refuses to write under a current key whose secret is not set', () => {
    process.env.CREDENTIALS_ENC_KEY_CURRENT = 'v3';

    expect(() => encryptedColumn.to('x')).toThrow(/CREDENTIALS_ENC_KEY_V3 is required/);
  });

  it('keyIdOf recognises only our shape', () => {
    expect(keyIdOf('v2:a:b:c')).toBe('v2');
    expect(keyIdOf('a plain token')).toBeNull();
    expect(keyIdOf('ghp:abc:def:ghi')).toBeNull();
    expect(keyIdOf('v2:a:b')).toBeNull();
  });

  it('decryptValue is strict where the column is lenient', () => {
    const stored = encryptValue('secret', 'v1');

    expect(decryptValue(stored)).toBe('secret');
    expect(() => decryptValue('plain')).toThrow(/not an encrypted value/);

    process.env.CREDENTIALS_ENC_KEY = randomBytes(32).toString('base64');

    expect(() => decryptValue(stored)).toThrow();
    expect(encryptedColumn.from(stored)).toBe(stored);
  });
});
