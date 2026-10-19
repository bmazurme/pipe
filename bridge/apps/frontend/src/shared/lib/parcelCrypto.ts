import { decryptBuffer, encryptBuffer } from '@pipe/protocol/encryption-browser';

export const ENCRYPTED_SUFFIX = '.enc';

export function isEncryptedFile(name: string): boolean {
  return name.endsWith(ENCRYPTED_SUFFIX);
}

export function stripEncryptedSuffix(name: string): string {
  return name.endsWith(ENCRYPTED_SUFFIX) ? name.slice(0, -ENCRYPTED_SUFFIX.length) : name;
}

// Wraps packages/protocol's Web Crypto implementation with Blob<->bytes
// conversion and error messages a user who just pasted the wrong key (or a
// key with the header line trimmed off) can actually act on — the raw
// DOMException/OperationError Web Crypto throws for "ciphertext doesn't
// match this key" says neither of those things.
export async function decryptParcel(encrypted: Blob, privateKeyPem: string): Promise<Blob> {
  if (!privateKeyPem.includes('PRIVATE KEY')) {
    throw new Error('Похоже, это не приватный ключ (нет заголовка «PRIVATE KEY»)');
  }

  const bytes = new Uint8Array(await encrypted.arrayBuffer());

  try {
    const decrypted = await decryptBuffer(bytes, privateKeyPem);
    return new Blob([new Uint8Array(decrypted)]);
  } catch {
    throw new Error('Не удалось расшифровать — неверный ключ или повреждённый файл');
  }
}

export async function encryptParcel(plain: Blob, publicKeyPem: string): Promise<Blob> {
  if (!publicKeyPem.includes('PUBLIC KEY')) {
    throw new Error('Похоже, это не публичный ключ (нет заголовка «PUBLIC KEY»)');
  }

  const bytes = new Uint8Array(await plain.arrayBuffer());

  try {
    const encrypted = await encryptBuffer(bytes, publicKeyPem);
    return new Blob([new Uint8Array(encrypted)]);
  } catch {
    throw new Error('Не удалось зашифровать — проверьте ключ');
  }
}

function pemBody(pem: string): Uint8Array<ArrayBuffer> {
  const binary = atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);

  return bytes;
}

function toPem(label: string, der: ArrayBuffer): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(der)));

  return `-----BEGIN ${label}-----\n${base64.match(/.{1,64}/g)?.join('\n') ?? ''}\n-----END ${label}-----\n`;
}

// The public half of an RSA private key (PKCS#8 PEM), in the SPKI PEM form encryptParcel and the worker expect. Web Crypto
// cannot export the public key straight from a private one, so the key goes through its JWK form (n, e) and back.
export async function publicKeyFromPrivate(privateKeyPem: string): Promise<string> {
  if (!privateKeyPem.includes('PRIVATE KEY')) {
    throw new Error('Похоже, это не приватный ключ (нет заголовка «PRIVATE KEY»)');
  }

  try {
    const algorithm = { name: 'RSA-OAEP', hash: 'SHA-256' };
    const privateKey = await crypto.subtle.importKey('pkcs8', pemBody(privateKeyPem), algorithm, true, ['decrypt']);
    const { n, e } = await crypto.subtle.exportKey('jwk', privateKey);
    const publicKey = await crypto.subtle.importKey('jwk', { kty: 'RSA', n, e, alg: 'RSA-OAEP-256', ext: true }, algorithm, true, ['encrypt']);

    return toPem('PUBLIC KEY', await crypto.subtle.exportKey('spki', publicKey));
  } catch {
    throw new Error('Не удалось получить публичный ключ из приватного — проверьте ключ');
  }
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
