import {
  constants,
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
} from 'crypto';

const AES_ALGO = 'aes-256-gcm';
const AES_KEY_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export type KeyPair = {
  publicKey: string;
  privateKey: string;
};

export function generateKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  return { publicKey, privateKey };
}

/**
 * Hybrid encryption: the parcel itself is encrypted with a random AES-256-GCM
 * key (asymmetric ciphers can't handle payloads this large), and only that
 * AES key is encrypted with the RSA-OAEP public key. Envelope layout:
 * [4 bytes encryptedKey length][encryptedKey][12 bytes iv][16 bytes authTag][ciphertext].
 */
export function encryptBuffer(data: Buffer, publicKeyPem: string): Buffer {
  const aesKey = randomBytes(AES_KEY_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(AES_ALGO, aesKey, iv);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const encryptedKey = publicEncrypt(
    { key: publicKeyPem, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING },
    aesKey,
  );

  const header = Buffer.alloc(4);

  header.writeUInt32BE(encryptedKey.length, 0);

  return Buffer.concat([header, encryptedKey, iv, authTag, ciphertext]);
}

export function decryptBuffer(envelope: Buffer, privateKeyPem: string): Buffer {
  const keyLength = envelope.readUInt32BE(0);
  let offset = 4;

  const encryptedKey = envelope.subarray(offset, offset + keyLength);

  offset += keyLength;

  const iv = envelope.subarray(offset, offset + IV_LENGTH);

  offset += IV_LENGTH;

  const authTag = envelope.subarray(offset, offset + AUTH_TAG_LENGTH);

  offset += AUTH_TAG_LENGTH;

  const ciphertext = envelope.subarray(offset);
  const aesKey = privateDecrypt(
    { key: privateKeyPem, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING },
    encryptedKey,
  );
  const decipher = createDecipheriv(AES_ALGO, aesKey, iv);

  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
