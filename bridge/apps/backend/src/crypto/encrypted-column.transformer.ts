import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { ValueTransformer } from 'typeorm';

const DEFAULT_KEY_ID = 'v1';
const KEY_ID_PATTERN = /^v\d{1,3}$/;
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

const logger = new Logger('encryptedColumn');

// One bad key would otherwise log once per row of every list that reads the column.
const WARN_EVERY_MS = 60_000;
const lastWarned = new Map<string, number>();

function warnUndecryptable(keyId: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  const signature = `${keyId}|${reason}`;
  const now = Date.now();

  if (now - (lastWarned.get(signature) ?? 0) < WARN_EVERY_MS) return;

  lastWarned.set(signature, now);
  // Never the value: only the key id and why it failed.
  logger.warn(
    `Could not decrypt an encrypted column value (key ${keyId}): ${reason}. ` +
      'The stored value is being returned unchanged — check CREDENTIALS_ENC_KEY (missing, rotated or wrong) or the row itself.',
  );
}

// Test hook: forget what was already warned about.
export function resetDecryptWarnings(): void {
  lastWarned.clear();
}

// S11: which key NEW values are written under. `CREDENTIALS_ENC_KEY_CURRENT=v2` (with CREDENTIALS_ENC_KEY_V2 set) starts a rotation: every value
// saved from then on is under v2, old ones keep decrypting under the key id stored beside them, and `reencrypt` (reencrypt.service.ts) moves the
// rest. An id that is not `v<N>` is a typo, and it fails loudly instead of quietly writing under a key nobody has.
export function currentKeyId(): string {
  const configured = process.env.CREDENTIALS_ENC_KEY_CURRENT?.trim();

  if (!configured) return DEFAULT_KEY_ID;
  if (!KEY_ID_PATTERN.test(configured)) {
    throw new Error(
      `CREDENTIALS_ENC_KEY_CURRENT must look like "v1", "v2"…, got "${configured}"`,
    );
  }

  return configured;
}

// Each key is its own env var (CREDENTIALS_ENC_KEY for "v1") so rotation
// doesn't require a backfill: set CREDENTIALS_ENC_KEY_CURRENT=v2, add
// CREDENTIALS_ENC_KEY_V2, and old rows keep decrypting against the key id
// recorded alongside their own ciphertext until they're next saved (which
// re-encrypts under the new key).
function resolveKey(keyId: string): Buffer {
  const envVar =
    keyId === 'v1'
      ? 'CREDENTIALS_ENC_KEY'
      : `CREDENTIALS_ENC_KEY_${keyId.toUpperCase()}`;
  const raw = process.env[envVar];

  if (!raw) {
    throw new Error(`${envVar} is required to encrypt/decrypt this column`);
  }

  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      `${envVar} must decode (base64) to exactly 32 bytes, got ${key.length}`,
    );
  }

  return key;
}

// The key id a stored value was written under, or null when it is not in our shape (a legacy plaintext row — never touched by a rotation).
export function keyIdOf(stored: string): string | null {
  const parts = stored.split(':');

  return parts.length === 4 && KEY_ID_PATTERN.test(parts[0]) ? parts[0] : null;
}

export function encryptValue(value: string, keyId = currentKeyId()): string {
  const key = resolveKey(keyId);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_BYTES,
  });
  const ciphertext = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    keyId,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

// The strict twin of the column's `from`: throws when the value does not decrypt, because a rotation that quietly "re-encrypted" an
// undecryptable value would turn a recoverable problem (the old key is somewhere) into a lost secret.
export function decryptValue(stored: string): string {
  const parts = stored.split(':');

  if (parts.length !== 4) throw new Error('not an encrypted value');

  const [keyId, ivB64, authTagB64, ciphertextB64] = parts;
  const key = resolveKey(keyId);
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');

  if (iv.length !== IV_BYTES) {
    throw new Error(`IV must be ${IV_BYTES} bytes, got ${iv.length}`);
  }
  if (authTag.length !== TAG_BYTES) {
    throw new Error(
      `auth tag must be ${TAG_BYTES} bytes, got ${authTag.length}`,
    );
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_BYTES,
  });
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

// AES-256-GCM, applied via TypeORM's column `transformer` option — plaintext
// never reaches Postgres for either ClaudeCredential.token or
// VpnConnection.panelApiToken. Stored shape: "<keyId>:<iv>:<authTag>:<ciphertext>",
// each part base64, so the key id travels with the value instead of being
// assumed from current config.
export const encryptedColumn: ValueTransformer = {
  to(value: string | null | undefined): string | null | undefined {
    if (value === null || value === undefined) return value;

    return encryptValue(value);
  },

  from(value: string | null | undefined): string | null | undefined {
    if (value === null || value === undefined) return value;

    const parts = value.split(':');
    // Not our format — a row written before this transformer existed.
    // Passed through as-is; it gets encrypted the next time this row is
    // saved, so no backfill migration is required before this can ship.
    if (parts.length !== 4) return value;

    const keyId = parts[0];

    try {
      return decryptValue(value);
    } catch (error) {
      warnUndecryptable(keyId, error);
      // Matched the shape but didn't decrypt (missing/rotated key, corrupt
      // value) — fail safe by handing back the raw stored value rather than
      // throwing and taking down every read of this entity. Whatever uses
      // this value (claude CLI auth, a panel request) then just fails its
      // own way instead, which is the right failure mode for a secret that
      // can't be recovered.
      return value;
    }
  },
};
