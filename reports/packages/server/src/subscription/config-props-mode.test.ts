import { describe, it, expect, vi } from 'vitest';

const writeJsonFileSync = vi.hoisted(() => vi.fn());

vi.mock('@pipe/protocol', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pipe/protocol')>()),
  writeJsonFileSync,
}));

vi.mock('./encryption', () => ({ generateKeyPair: () => ({ publicKey: 'pub', privateKey: 'priv' }) }));

import { generateAndSaveKeyPair, setSubscriptionConfig } from './config-props';

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
