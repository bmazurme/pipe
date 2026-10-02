import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { generateKeyPair, encryptBuffer as encryptNode, decryptBuffer as decryptNode } from './encryption.js';
import { encryptBuffer as encryptBrowser, decryptBuffer as decryptBrowser } from './encryption-browser.js';

function toBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('encryptBuffer / decryptBuffer (Web Crypto)', () => {
  it('round-trips a buffer through the public/private key pair', async () => {
    const { publicKey, privateKey } = generateKeyPair();
    const original = toBytes('a fairly large parcel payload'.repeat(1000));

    const envelope = await encryptBrowser(original, publicKey);
    const decrypted = await decryptBrowser(envelope, privateKey);

    assert.deepEqual(decrypted, original);
  });

  it('fails to decrypt with the wrong private key', async () => {
    const { publicKey } = generateKeyPair();
    const { privateKey: wrongPrivateKey } = generateKeyPair();
    const envelope = await encryptBrowser(toBytes('data'), publicKey);

    await assert.rejects(decryptBrowser(envelope, wrongPrivateKey));
  });

  it('fails to decrypt a tampered envelope (auth tag check)', async () => {
    const { publicKey, privateKey } = generateKeyPair();
    const envelope = await encryptBrowser(toBytes('data'), publicKey);

    envelope[envelope.length - 1] ^= 0xff;

    await assert.rejects(decryptBrowser(envelope, privateKey));
  });
});

// The whole point of this file: sync-cli, reports, and anyone else producing
// envelopes with the Node implementation must be decryptable here, and a
// parcel decrypted/re-encrypted in a browser must round-trip back through
// the Node side unchanged — both directions, byte for byte.
describe('interop with encryption.ts (node:crypto)', () => {
  it('decrypts (Web Crypto) an envelope encrypted by encryption.ts (node:crypto)', async () => {
    const { publicKey, privateKey } = generateKeyPair();
    const original = Buffer.from('produced on the Node side', 'utf-8');

    const envelope = encryptNode(original, publicKey);
    const decrypted = await decryptBrowser(new Uint8Array(envelope), privateKey);

    assert.deepEqual(Buffer.from(decrypted), original);
  });

  it('decrypts (node:crypto) an envelope encrypted by encryption-browser.ts (Web Crypto)', async () => {
    const { publicKey, privateKey } = generateKeyPair();
    const original = toBytes('produced on the browser side');

    const envelope = await encryptBrowser(original, publicKey);
    const decrypted = decryptNode(Buffer.from(envelope), privateKey);

    assert.deepEqual(new Uint8Array(decrypted), original);
  });
});
