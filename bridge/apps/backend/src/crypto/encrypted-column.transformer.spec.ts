import { randomBytes } from 'node:crypto';

import { encryptedColumn } from './encrypted-column.transformer';

const ORIGINAL_ENV = process.env.CREDENTIALS_ENC_KEY;

describe('encryptedColumn', () => {
  beforeEach(() => {
    process.env.CREDENTIALS_ENC_KEY = randomBytes(32).toString('base64');
  });

  afterAll(() => {
    process.env.CREDENTIALS_ENC_KEY = ORIGINAL_ENV;
  });

  it('round-trips a value through encryption and decryption', () => {
    const encrypted = encryptedColumn.to('sk-ant-oat-secret') as string;
    expect(encrypted).not.toContain('sk-ant-oat-secret');

    const decrypted = encryptedColumn.from(encrypted);
    expect(decrypted).toBe('sk-ant-oat-secret');
  });

  it('produces a different ciphertext for the same value each time (random IV)', () => {
    const first = encryptedColumn.to('same-value') as string;
    const second = encryptedColumn.to('same-value') as string;
    expect(first).not.toBe(second);
  });

  it('passes null/undefined through unchanged', () => {
    expect(encryptedColumn.to(null)).toBeNull();
    expect(encryptedColumn.from(null)).toBeNull();
    expect(encryptedColumn.to(undefined)).toBeUndefined();
  });

  it('passes a pre-existing plaintext row through unchanged on read (no backfill required)', () => {
    const legacyPlaintextValue =
      'sk-ant-oat-already-in-the-db-before-this-shipped';
    expect(encryptedColumn.from(legacyPlaintextValue)).toBe(
      legacyPlaintextValue,
    );
  });

  it('throws on write when CREDENTIALS_ENC_KEY is not set', () => {
    delete process.env.CREDENTIALS_ENC_KEY;
    expect(() => encryptedColumn.to('secret')).toThrow(
      'CREDENTIALS_ENC_KEY is required',
    );
  });

  it('fails safe (returns the raw stored value) when the recorded key id is missing', () => {
    const encrypted = encryptedColumn.to('secret') as string;
    delete process.env.CREDENTIALS_ENC_KEY;
    expect(encryptedColumn.from(encrypted)).toBe(encrypted);
  });
});
