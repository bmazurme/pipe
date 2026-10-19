import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { saveConfig } from '../config.js';
import { decryptBuffer, encryptBuffer } from '../encryption.js';
import { CONFIG_PATH } from '../paths.js';
import type { SyncConfig } from '../types.js';
import { generateKeysCommand } from './generateKeys.js';

// CONFIG_PATH is a fixed path, so back it up and restore it afterwards.
const originalConfig = existsSync(CONFIG_PATH) ? readFileSync(CONFIG_PATH, 'utf-8') : null;

const NAME = 'generate-keys-test-project';

let dir: string;
let publicPath: string;
let privatePath: string;

function writeConfig(withKeys = true): void {
  const config: SyncConfig = {
    bridge: { apiUrl: 'https://bridge.example.com' },
    projects: [
      {
        name: NAME,
        path: dir,
        ...(withKeys ? { publicKeyPath: publicPath, privateKeyPath: privatePath } : {}),
      },
    ],
  };
  saveConfig(config);
}

const mode = (p: string): number => statSync(p).mode & 0o777;

after(() => {
  if (originalConfig === null) rmSync(CONFIG_PATH, { force: true });
  else writeFileSync(CONFIG_PATH, originalConfig);
});

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'sync-cli-genkeys-test-'));
  publicPath = path.join(dir, 'keys', 'public.pem');
  privatePath = path.join(dir, 'keys', 'private.pem');
  writeConfig();
});

describe('generateKeysCommand', () => {
  it('throws when the project has no key paths', () => {
    writeConfig(false);
    assert.throws(() => generateKeysCommand(NAME, {}), /no publicKeyPath\/privateKeyPath/);
  });

  it('refuses to overwrite existing keys without --force', () => {
    generateKeysCommand(NAME, {});
    const pub = readFileSync(publicPath);
    const priv = readFileSync(privatePath);

    assert.throws(() => generateKeysCommand(NAME, {}), /--force/);

    assert.deepEqual(readFileSync(publicPath), pub);
    assert.deepEqual(readFileSync(privatePath), priv);
  });

  it('writes keys with the right modes that round-trip', () => {
    generateKeysCommand(NAME, {});

    assert.equal(mode(privatePath), 0o600);
    assert.equal(mode(publicPath), 0o644);

    const data = Buffer.from('secret parcel');
    const envelope = encryptBuffer(data, readFileSync(publicPath, 'utf-8'));
    assert.deepEqual(decryptBuffer(envelope, readFileSync(privatePath, 'utf-8')), data);
  });

  it('--force tightens an existing loose private key to 0600', () => {
    generateKeysCommand(NAME, {});
    chmodSync(privatePath, 0o644);
    chmodSync(publicPath, 0o600);

    generateKeysCommand(NAME, { force: true });

    assert.equal(mode(privatePath), 0o600);
    assert.equal(mode(publicPath), 0o644);
  });
});
