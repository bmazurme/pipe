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

describe('decryptBuffer envelope validation', () => {
  const malformed = /Malformed encrypted parcel envelope/;

  it('rejects an empty buffer', () => {
    const { privateKey } = generateKeyPair();

    assert.throws(() => decryptBuffer(Buffer.alloc(0), privateKey), malformed);
  });

  it('rejects a buffer shorter than the 4-byte header', () => {
    const { privateKey } = generateKeyPair();

    assert.throws(() => decryptBuffer(Buffer.from([0, 0, 1]), privateKey), malformed);
  });

  it('rejects a truncated real envelope', () => {
    const { publicKey, privateKey } = generateKeyPair();
    const envelope = encryptBuffer(Buffer.from('data'), publicKey);
    const keyLength = envelope.readUInt32BE(0);
    // Cut inside the auth tag, so the key and iv are intact but the tag is short.
    const truncated = envelope.subarray(0, 4 + keyLength + 12 + 8);

    assert.throws(() => decryptBuffer(truncated, privateKey), malformed);
  });

  it('rejects a header whose keyLength exceeds the buffer', () => {
    const { privateKey } = generateKeyPair();
    const bogus = Buffer.alloc(64);

    bogus.writeUInt32BE(0xffffffff, 0);

    assert.throws(() => decryptBuffer(bogus, privateKey), malformed);
  });

  it('still round-trips a valid envelope and keeps GCM tamper errors', () => {
    const { publicKey, privateKey } = generateKeyPair();
    const original = Buffer.from('payload');
    const envelope = encryptBuffer(original, publicKey);

    assert.ok(decryptBuffer(envelope, privateKey).equals(original));

    envelope[envelope.length - 1] ^= 0xff;

    assert.throws(
      () => decryptBuffer(envelope, privateKey),
      (err: Error) => !malformed.test(err.message) && /authenticate/i.test(err.message),
    );
  });
});
