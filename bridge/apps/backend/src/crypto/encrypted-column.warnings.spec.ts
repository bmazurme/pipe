import { randomBytes } from 'node:crypto';

import { Logger } from '@nestjs/common';

import {
  encryptedColumn,
  resetDecryptWarnings,
} from './encrypted-column.transformer';

describe('encryptedColumn decrypt failures', () => {
  let warn: jest.SpyInstance;
  const original = process.env.CREDENTIALS_ENC_KEY;

  beforeEach(() => {
    process.env.CREDENTIALS_ENC_KEY = randomBytes(32).toString('base64');
    resetDecryptWarnings();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    process.env.CREDENTIALS_ENC_KEY = original;
  });

  it('logs a warning and still returns the stored value when the key changed', () => {
    const stored = encryptedColumn.to!('top secret') as string;

    process.env.CREDENTIALS_ENC_KEY = randomBytes(32).toString('base64');

    expect(encryptedColumn.from!(stored)).toBe(stored);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('Could not decrypt');
    expect(String(warn.mock.calls[0][0])).toContain('CREDENTIALS_ENC_KEY');
  });

  it('never puts the stored value or the plaintext in the log', () => {
    const stored = encryptedColumn.to!('top secret') as string;

    process.env.CREDENTIALS_ENC_KEY = randomBytes(32).toString('base64');
    encryptedColumn.from!(stored);

    const logged = warn.mock.calls.map((call) => String(call[0])).join('\n');

    expect(logged).not.toContain('top secret');
    expect(logged).not.toContain(stored);
    expect(logged).not.toContain(stored.split(':')[3]);
  });

  it('says so when the key is missing altogether', () => {
    const stored = encryptedColumn.to!('x') as string;

    delete process.env.CREDENTIALS_ENC_KEY;
    encryptedColumn.from!(stored);

    expect(String(warn.mock.calls[0][0])).toContain('is required');
  });

  it('warns once, not once per row, while the same problem persists', () => {
    const stored = encryptedColumn.to!('x') as string;

    process.env.CREDENTIALS_ENC_KEY = randomBytes(32).toString('base64');
    for (let i = 0; i < 50; i += 1) encryptedColumn.from!(stored);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does not warn for a legacy plaintext row or a value that decrypts', () => {
    const stored = encryptedColumn.to!('hello') as string;

    expect(encryptedColumn.from!('plain legacy token')).toBe(
      'plain legacy token',
    );
    expect(encryptedColumn.from!(stored)).toBe('hello');
    expect(encryptedColumn.from!(null)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});
