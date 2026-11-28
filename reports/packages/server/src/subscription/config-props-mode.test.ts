import { describe, it, expect, vi } from 'vitest';

const writeJsonFileSync = vi.hoisted(() => vi.fn());

vi.mock('@pipe/protocol', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pipe/protocol')>()),
  writeJsonFileSync,
}));

vi.mock('./encryption', () => ({ generateKeyPair: () => ({ publicKey: 'pub', privateKey: 'priv' }) }));

import { generateAndSaveKeyPair, setLeakScanMode, setSubscriptionConfig } from './config-props';

describe('subscription-config.json file mode', () => {
  it('setSubscriptionConfig writes owner-only', () => {
    setSubscriptionConfig({ trackedProjects: [], dictionary: [], commentTemplates: [], encryption: { enabled: false, publicKey: '', privateKey: '' } });

    expect(writeJsonFileSync).toHaveBeenLastCalledWith(expect.stringMatching(/subscription-config\.json$/), expect.anything(), { mode: 0o600 });
  });

  it('generateAndSaveKeyPair writes owner-only', () => {
    writeJsonFileSync.mockClear();
    generateAndSaveKeyPair();

    expect(writeJsonFileSync).toHaveBeenCalledTimes(1);
    expect(writeJsonFileSync).toHaveBeenCalledWith(expect.stringMatching(/subscription-config\.json$/), expect.anything(), { mode: 0o600 });
  });
});

describe('setLeakScanMode', () => {
  it('stores the mode and drops the legacy leakScanStrict it replaces', () => {
    setSubscriptionConfig({
      trackedProjects: [],
      dictionary: [],
      commentTemplates: [],
      encryption: { enabled: false, publicKey: '', privateKey: '' },
      leakScanStrict: true,
    });
    writeJsonFileSync.mockClear();

    const saved = setLeakScanMode('warn');

    expect(saved.leakScanMode).toBe('warn');
    expect('leakScanStrict' in saved).toBe(false);
    expect(writeJsonFileSync).toHaveBeenCalledTimes(1);
  });
});
