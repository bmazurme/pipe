import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  addDictionaryEntry,
  removeDictionaryEntry,
  updateDictionaryEntry,
  importDictionaryEntries,
  getSubscriptionConfig,
  setEncryptionSettings,
  generateAndSaveKeyPair,
} from './config-props';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, 'subscription-config.json');

let originalContent: string | null;

beforeEach(() => {
  originalContent = existsSync(configPath) ? readFileSync(configPath, 'utf-8') : null;
  writeFileSync(configPath, JSON.stringify({ trackedProjects: [], dictionary: [], commentTemplates: [] }));
});

afterEach(() => {
  if (originalContent === null) {
    rmSync(configPath, { force: true });
  } else {
    writeFileSync(configPath, originalContent);
  }
});

describe('dictionary config-props', () => {
  it('addDictionaryEntry upserts by key', () => {
    addDictionaryEntry({ key: 'real', value: '{{PLACEHOLDER}}' });
    const updated = addDictionaryEntry({ key: 'real', value: '{{NEW}}' });

    expect(updated.dictionary).toEqual([{ key: 'real', value: '{{NEW}}' }]);
  });

  it('removeDictionaryEntry removes by key', () => {
    addDictionaryEntry({ key: 'real', value: '{{PLACEHOLDER}}' });
    const updated = removeDictionaryEntry('real');

    expect(updated.dictionary).toEqual([]);
  });

  it('updateDictionaryEntry renames the key while preserving the rest of the list', () => {
    addDictionaryEntry({ key: 'a', value: '1' });
    addDictionaryEntry({ key: 'b', value: '2' });

    const updated = updateDictionaryEntry('a', { key: 'a-renamed', value: '1' });

    expect(updated.dictionary).toEqual(expect.arrayContaining([
      { key: 'a-renamed', value: '1' },
      { key: 'b', value: '2' },
    ]));
    expect(updated.dictionary).toHaveLength(2);
  });

  it('importDictionaryEntries merges, upserting by key and skipping incomplete entries', () => {
    addDictionaryEntry({ key: 'existing', value: 'old' });

    const updated = importDictionaryEntries([
      { key: 'existing', value: 'updated' },
      { key: 'new-key', value: 'new-value' },
      { key: '', value: 'skipped: empty key' },
      { key: 'skipped-empty-value', value: '' },
    ]);

    expect(updated.dictionary).toEqual(expect.arrayContaining([
      { key: 'existing', value: 'updated' },
      { key: 'new-key', value: 'new-value' },
    ]));
    expect(updated.dictionary).toHaveLength(2);
  });

  it('getSubscriptionConfig reflects what was persisted', () => {
    addDictionaryEntry({ key: 'a', value: '1' });

    expect(getSubscriptionConfig().dictionary).toEqual([{ key: 'a', value: '1' }]);
  });
});

describe('encryption config-props', () => {
  it('defaults encryption to disabled with empty keys when nothing is persisted', () => {
    expect(getSubscriptionConfig().encryption).toEqual({ enabled: false, publicKey: '', privateKey: '' });
  });

  it('setEncryptionSettings replaces the encryption block', () => {
    const updated = setEncryptionSettings({ enabled: true, publicKey: 'pub', privateKey: 'priv' });

    expect(updated.encryption).toEqual({ enabled: true, publicKey: 'pub', privateKey: 'priv' });
  });

  it('generateAndSaveKeyPair fills in a real PEM key pair without touching "enabled"', () => {
    setEncryptionSettings({ enabled: true, publicKey: '', privateKey: '' });

    const updated = generateAndSaveKeyPair();

    expect(updated.encryption.enabled).toBe(true);
    expect(updated.encryption.publicKey).toContain('BEGIN PUBLIC KEY');
    expect(updated.encryption.privateKey).toContain('BEGIN PRIVATE KEY');
  });
});
