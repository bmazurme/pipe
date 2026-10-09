import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { ValueTransformer } from 'typeorm';

const CURRENT_KEY_ID = 'v1';
const ALGORITHM = 'aes-256-gcm';

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

// Each key is its own env var (CREDENTIALS_ENC_KEY for "v1") so rotation
// doesn't require a backfill: bump CURRENT_KEY_ID, add
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

// AES-256-GCM, applied via TypeORM's column `transformer` option — plaintext
// never reaches Postgres for either ClaudeCredential.token or
// VpnConnection.panelApiToken. Stored shape: "<keyId>:<iv>:<authTag>:<ciphertext>",
// each part base64, so the key id travels with the value instead of being
// assumed from current config.
export const encryptedColumn: ValueTransformer = {
  to(value: string | null | undefined): string | null | undefined {
    if (value === null || value === undefined) return value;

    const key = resolveKey(CURRENT_KEY_ID);
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      CURRENT_KEY_ID,
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  },

  from(value: string | null | undefined): string | null | undefined {
    if (value === null || value === undefined) return value;

    const parts = value.split(':');
    // Not our format — a row written before this transformer existed.
    // Passed through as-is; it gets encrypted the next time this row is
    // saved, so no backfill migration is required before this can ship.
    if (parts.length !== 4) return value;

    const [keyId, ivB64, authTagB64, ciphertextB64] = parts;

    try {
      const key = resolveKey(keyId);
      const iv = Buffer.from(ivB64, 'base64');
      const authTag = Buffer.from(authTagB64, 'base64');
      const ciphertext = Buffer.from(ciphertextB64, 'base64');

      const decipher = createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);

      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString('utf8');
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
