import { describe, it, expect, vi } from 'vitest';

const writeJsonFileSync = vi.hoisted(() => vi.fn());

vi.mock('@pipe/protocol', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pipe/protocol')>()),
  writeJsonFileSync,
}));

import { setSettings } from './props';

describe('setSettings file mode', () => {
  it('writes settings.json owner-only', () => {
    setSettings({
      gitlabUrl: '',
      privateToken: 't',
      userId: '',
      employee: '',
      company: '',
      bridgeApiUrl: '',
      bridgeApiKey: '',
      bridgeStorageApiKey: '',
    });

    expect(writeJsonFileSync).toHaveBeenCalledWith(expect.stringMatching(/settings\.json$/), expect.anything(), { mode: 0o600 });
  });
});
