// Browser-compatible counterpart to encryption.ts — same hybrid RSA-OAEP +
// AES-256-GCM envelope format (see that file's own doc comment for the exact
// byte layout), reimplemented against the standard Web Crypto API
// (globalThis.crypto.subtle) instead of node:crypto, since encryption.ts
// cannot be imported from browser code (see this package's README/CLAUDE.md
// on why the bare @pipe/protocol barrel breaks the Vite build). Keys never
// have to leave the browser tab to decrypt/encrypt a parcel with this.
//
// Produces byte-identical envelopes to encryption.ts and can decrypt
// anything it encrypted, and vice versa — verified directly in
// encryption-browser.test.ts, which round-trips through both
// implementations in the same (Node, which also implements Web Crypto
// natively) test process.

const AES_KEY_LENGTH_BYTES = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH_BITS = 128;
const AUTH_TAG_LENGTH_BYTES = AUTH_TAG_LENGTH_BITS / 8;

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function importRsaPublicKey(publicKeyPem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'spki',
    pemToArrayBuffer(publicKeyPem),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );
}

export async function importRsaPrivateKey(privateKeyPem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKeyPem),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['decrypt'],
  );
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result: Uint8Array<ArrayBuffer> = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export async function encryptBuffer(data: Uint8Array, publicKeyPem: string): Promise<Uint8Array> {
  const publicKey = await importRsaPublicKey(publicKeyPem);
  const aesKeyBytes = crypto.getRandomValues(new Uint8Array(AES_KEY_LENGTH_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const aesKey = await crypto.subtle.importKey('raw', aesKeyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  // SubtleCrypto appends the auth tag to the ciphertext; the envelope keeps
  // them in separate fixed-size slots (matching encryption.ts, which gets
  // them apart natively via Node's cipher.getAuthTag()), so split it back out.
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: AUTH_TAG_LENGTH_BITS }, aesKey, new Uint8Array(data)),
  );
  const ciphertext = encrypted.slice(0, encrypted.length - AUTH_TAG_LENGTH_BYTES);
  const authTag = encrypted.slice(encrypted.length - AUTH_TAG_LENGTH_BYTES);

  const encryptedKey = new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, aesKeyBytes));

  const header = new Uint8Array(4);
  new DataView(header.buffer).setUint32(0, encryptedKey.length, false);

  return concat(header, encryptedKey, iv, authTag, ciphertext);
}

export async function decryptBuffer(envelope: Uint8Array, privateKeyPem: string): Promise<Uint8Array> {
  const privateKey = await importRsaPrivateKey(privateKeyPem);

  const keyLength = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength).getUint32(0, false);
  let offset = 4;

  const encryptedKey = envelope.slice(offset, offset + keyLength);
  offset += keyLength;

  const iv = envelope.slice(offset, offset + IV_LENGTH);
  offset += IV_LENGTH;

  const authTag = envelope.slice(offset, offset + AUTH_TAG_LENGTH_BYTES);
  offset += AUTH_TAG_LENGTH_BYTES;

  const ciphertext = envelope.slice(offset);

  const aesKeyBytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, encryptedKey));
  const aesKey = await crypto.subtle.importKey('raw', aesKeyBytes, { name: 'AES-GCM' }, false, ['decrypt']);

  // SubtleCrypto expects the tag appended back onto the ciphertext — the
  // reverse of the split done in encryptBuffer above.
  const combined = concat(ciphertext, authTag);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: AUTH_TAG_LENGTH_BITS }, aesKey, combined);

  return new Uint8Array(decrypted);
}
