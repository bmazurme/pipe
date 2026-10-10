import { randomBytes } from 'node:crypto';

import { Logger } from '@nestjs/common';

import {
  encryptedColumn,
  resetDecryptWarnings,
} from './encrypted-column.transformer';

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

describe('encryptedColumn decrypt warnings', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    process.env.CREDENTIALS_ENC_KEY = randomBytes(32).toString('base64');
    resetDecryptWarnings();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    warn.mockRestore();
  });

  afterAll(() => {
    process.env.CREDENTIALS_ENC_KEY = ORIGINAL_ENV;
  });

  it('returns the raw value and warns once, without leaking the value, when the key is wrong', () => {
    const encrypted = encryptedColumn.to('plain-secret-value') as string;
    process.env.CREDENTIALS_ENC_KEY = randomBytes(32).toString('base64');

    expect(encryptedColumn.from(encrypted)).toBe(encrypted);
    expect(encryptedColumn.from(encrypted)).toBe(encrypted);

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('v1');
    expect(message).not.toContain('plain-secret-value');
    expect(message).not.toContain(encrypted.split(':')[3]);
  });

  it('warns naming the env var when the key is missing', () => {
    const encrypted = encryptedColumn.to('secret') as string;
    delete process.env.CREDENTIALS_ENC_KEY;

    expect(encryptedColumn.from(encrypted)).toBe(encrypted);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('CREDENTIALS_ENC_KEY');
  });

  it('does not warn for a legacy plaintext row', () => {
    encryptedColumn.from('legacy-plaintext');
    expect(warn).not.toHaveBeenCalled();
  });
});
