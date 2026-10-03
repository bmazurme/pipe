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
