import { describe, it, expect } from 'vitest';

import { generateKeyPair, encryptBuffer, decryptBuffer } from './encryption';

// RSA key generation is CPU-bound; on a busy CI runner a test that generates
// two pairs exceeded vitest's 5s default and failed intermittently.
const KEYGEN_TIMEOUT_MS = 30_000;

describe('generateKeyPair', { timeout: KEYGEN_TIMEOUT_MS }, () => {
  it('produces a PEM-encoded RSA key pair', () => {
    const { publicKey, privateKey } = generateKeyPair();

    expect(publicKey).toContain('BEGIN PUBLIC KEY');
    expect(privateKey).toContain('BEGIN PRIVATE KEY');
  });
});

describe('encryptBuffer / decryptBuffer', { timeout: KEYGEN_TIMEOUT_MS }, () => {
  it('round-trips a buffer through the public/private key pair', () => {
    const { publicKey, privateKey } = generateKeyPair();
    const original = Buffer.from('a fairly large parcel payload'.repeat(1000), 'utf-8');

    const envelope = encryptBuffer(original, publicKey);
    const decrypted = decryptBuffer(envelope, privateKey);

    expect(decrypted.equals(original)).toBe(true);
  });

  it('does not contain the plaintext anywhere in the envelope', () => {
    const { publicKey } = generateKeyPair();
    const original = Buffer.from('super-secret-marker-value', 'utf-8');

    const envelope = encryptBuffer(original, publicKey);

    expect(envelope.includes('super-secret-marker-value')).toBe(false);
  });

  it('fails to decrypt with the wrong private key', () => {
    const { publicKey } = generateKeyPair();
    const { privateKey: wrongPrivateKey } = generateKeyPair();
    const envelope = encryptBuffer(Buffer.from('data'), publicKey);

    expect(() => decryptBuffer(envelope, wrongPrivateKey)).toThrow();
  });

  it('fails to decrypt a tampered envelope (auth tag check)', () => {
    const { publicKey, privateKey } = generateKeyPair();
    const envelope = encryptBuffer(Buffer.from('data'), publicKey);

    envelope[envelope.length - 1] ^= 0xff;

    expect(() => decryptBuffer(envelope, privateKey)).toThrow();
  });
});
