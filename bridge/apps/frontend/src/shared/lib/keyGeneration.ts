// RSA key pairs for encrypting parcels, generated entirely in the browser (Web
// Crypto) — the private key never leaves this tab unless the user downloads it.
// Same formats and parameters as reports' and sync's server-side generator
// (packages/protocol/src/encryption.ts generateKeyPair): RSA-OAEP / SHA-256,
// public key as SPKI PEM ("BEGIN PUBLIC KEY"), private key as PKCS#8 PEM
// ("BEGIN PRIVATE KEY"), 4096-bit by default — so a pair made here works in both.

export const KEY_SIZES = [4096, 3072, 2048] as const;
export type KeySize = (typeof KEY_SIZES)[number];
export const DEFAULT_KEY_SIZE: KeySize = 4096;

export interface GeneratedKeyPair {
  publicKey: string;
  privateKey: string;
  /** SHA-256 of the public key's DER, as "AB:CD:…" — identifies a pair without exposing it. */
  fingerprint: string;
}

function toBase64(bytes: ArrayBuffer): string {
  let binary = '';
  new Uint8Array(bytes).forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary);
}

/** PEM-armors DER bytes the way OpenSSL does: 64 characters per line. */
export function toPem(der: ArrayBuffer, label: 'PUBLIC KEY' | 'PRIVATE KEY'): string {
  const lines = toBase64(der).match(/.{1,64}/g) ?? [];

  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

function derOf(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  return bytes.buffer;
}

export async function fingerprintOfPublicKey(publicKeyPem: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', derOf(publicKeyPem)));

  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

export async function generateRsaKeyPair(size: KeySize = DEFAULT_KEY_SIZE): Promise<GeneratedKeyPair> {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: size, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    // Extractable: the user is meant to be able to save the pair.
    true,
    ['encrypt', 'decrypt'],
  );
  const publicKey = toPem(await crypto.subtle.exportKey('spki', pair.publicKey), 'PUBLIC KEY');
  const privateKey = toPem(await crypto.subtle.exportKey('pkcs8', pair.privateKey), 'PRIVATE KEY');

  return { publicKey, privateKey, fingerprint: await fingerprintOfPublicKey(publicKey) };
}

export type KeyKind = 'private' | 'public';

export function keyKind(pem: string): KeyKind | null {
  if (pem.includes('PRIVATE KEY')) return 'private';
  if (pem.includes('PUBLIC KEY')) return 'public';

  return null;
}

/** Filesystem-safe file name for a downloaded key. */
export function keyFileName(name: string, kind: KeyKind): string {
  const base = name.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'key';

  return `${base}-${kind}.pem`;
}
