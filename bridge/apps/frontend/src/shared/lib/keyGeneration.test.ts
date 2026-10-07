import { describe, expect, it } from 'vitest';
import { decryptBuffer as decryptNode, encryptBuffer as encryptNode } from '@pipe/protocol/encryption';
import { decryptBuffer as decryptBrowser, encryptBuffer as encryptBrowser } from '@pipe/protocol/encryption-browser';

import { fingerprintOfPublicKey, generateRsaKeyPair, keyFileName, keyKind, toPem } from './keyGeneration';

describe('generateRsaKeyPair', () => {
  it('produces OpenSSL-style PEMs: SPKI public key, PKCS#8 private key, 64-column lines', async () => {
    const { publicKey, privateKey } = await generateRsaKeyPair(2048);

    expect(publicKey.startsWith('-----BEGIN PUBLIC KEY-----\n')).toBe(true);
    expect(publicKey.endsWith('-----END PUBLIC KEY-----\n')).toBe(true);
    expect(privateKey.startsWith('-----BEGIN PRIVATE KEY-----\n')).toBe(true);
    for (const line of publicKey.split('\n').slice(1, -2)) expect(line.length).toBeLessThanOrEqual(64);
  }, 60_000);

  it('works with the parcel crypto already used by sync, reports and bridge, in both directions', async () => {
    const { publicKey, privateKey } = await generateRsaKeyPair(2048);
    const plain = new TextEncoder().encode('parcel contents');

    // generated here → encrypted by the browser impl → opened by the Node impl (reports/sync side)
    const fromBrowser = await encryptBrowser(plain, publicKey);
    expect(Array.from(decryptNode(Buffer.from(fromBrowser), privateKey))).toEqual(Array.from(plain));

    // …and the other way round
    const fromNode = encryptNode(Buffer.from(plain), publicKey);
    expect(Array.from(await decryptBrowser(new Uint8Array(fromNode), privateKey))).toEqual(Array.from(plain));
  }, 60_000);

  it('returns a stable, readable fingerprint of the public key', async () => {
    const { publicKey, fingerprint } = await generateRsaKeyPair(2048);

    expect(fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(await fingerprintOfPublicKey(publicKey)).toBe(fingerprint);
  }, 60_000);

  it('generates a different pair every time', async () => {
    const [a, b] = await Promise.all([generateRsaKeyPair(2048), generateRsaKeyPair(2048)]);

    expect(a.publicKey).not.toBe(b.publicKey);
  }, 60_000);
});

describe('helpers', () => {
  it('wraps DER at 64 columns', () => {
    const pem = toPem(new Uint8Array(100).buffer, 'PUBLIC KEY');
    const body = pem.split('\n').slice(1, -2);

    expect(body[0]).toHaveLength(64);
    expect(body.length).toBeGreaterThan(1);
  });

  it('tells private from public and rejects anything else', () => {
    expect(keyKind('-----BEGIN PRIVATE KEY-----\nx')).toBe('private');
    expect(keyKind('-----BEGIN PUBLIC KEY-----\nx')).toBe('public');
    expect(keyKind('hello')).toBeNull();
  });

  it('builds a safe file name, keeping non-latin letters', () => {
    expect(keyFileName('Мой ключ / test!', 'private')).toBe('мой-ключ-test-private.pem');
    expect(keyFileName('   ', 'public')).toBe('key-public.pem');
  });
});
