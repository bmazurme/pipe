import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { generateKeyPair, encryptBuffer, decryptBuffer } from './encryption.js';

describe('generateKeyPair', () => {
  it('produces a PEM-encoded RSA key pair', () => {
    const { publicKey, privateKey } = generateKeyPair();

    assert.match(publicKey, /BEGIN PUBLIC KEY/);
    assert.match(privateKey, /BEGIN PRIVATE KEY/);
  });
});

describe('encryptBuffer / decryptBuffer', () => {
  it('round-trips a buffer through the public/private key pair', () => {
    const { publicKey, privateKey } = generateKeyPair();
    const original = Buffer.from('a fairly large parcel payload'.repeat(1000), 'utf-8');

    const envelope = encryptBuffer(original, publicKey);
    const decrypted = decryptBuffer(envelope, privateKey);

    assert.ok(decrypted.equals(original));
  });

  it('does not contain the plaintext anywhere in the envelope', () => {
    const { publicKey } = generateKeyPair();
    const original = Buffer.from('super-secret-marker-value', 'utf-8');

    const envelope = encryptBuffer(original, publicKey);

    assert.equal(envelope.includes('super-secret-marker-value'), false);
  });

  it('fails to decrypt with the wrong private key', () => {
    const { publicKey } = generateKeyPair();
    const { privateKey: wrongPrivateKey } = generateKeyPair();
    const envelope = encryptBuffer(Buffer.from('data'), publicKey);

    assert.throws(() => decryptBuffer(envelope, wrongPrivateKey));
  });

  it('fails to decrypt a tampered envelope (auth tag check)', () => {
    const { publicKey, privateKey } = generateKeyPair();
    const envelope = encryptBuffer(Buffer.from('data'), publicKey);

    envelope[envelope.length - 1] ^= 0xff;

    assert.throws(() => decryptBuffer(envelope, privateKey));
  });
});
