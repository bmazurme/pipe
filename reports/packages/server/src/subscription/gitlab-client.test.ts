import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SettingsType } from '@reports/shared';

// settings/props.ts reads/writes the real settings.json on disk — mocked
// here instead of calling setSettings() for real, since that file is shared
// with settings/props.test.ts's own tests and vitest runs test files in
// parallel by default. Both writing to the same real file concurrently was
// a genuine (if intermittent) race: settings/props.test.ts's own
// "persists new settings" assertion could observe whatever this file's
// beforeEach last wrote instead of what it just set.
const getSettingsMock = vi.fn<() => SettingsType>();
vi.mock('../settings/props', () => ({ getSettings: () => getSettingsMock() }));

const { getIssueImages } = await import('./gitlab-client');

function stubSettings(overrides: Partial<SettingsType> = {}) {
  getSettingsMock.mockReturnValue({
    gitlabUrl: 'https://gitlab.example.com/api/v4',
    privateToken: 'token-123',
    userId: '',
    employee: '',
    company: '',
    bridgeApiUrl: '',
    bridgeApiKey: '',
    bridgeRefreshToken: '',
    bridgeStorageApiKey: '',
    ...overrides,
  });
}

beforeEach(() => {
  stubSettings();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const PNG_BYTES = new Uint8Array([1, 2, 3, 4]);

describe('getIssueImages', () => {
  it('returns nothing when the description has no image references', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const images = await getIssueImages('Just text, no attachments.');

    expect(images).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('downloads a relative /uploads/ image with the GitLab auth header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(PNG_BYTES, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const images = await getIssueImages('See: ![screenshot](/uploads/abc/screenshot.png)');

    expect(images).toEqual([{ relPath: 'issue-images/screenshot.png', base64: Buffer.from(PNG_BYTES).toString('base64') }]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://gitlab.example.com/uploads/abc/screenshot.png',
      expect.objectContaining({ headers: expect.objectContaining({ 'Private-Token': 'token-123' }) }),
    );
  });

  it('downloads an absolute image URL on the same GitLab instance', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(PNG_BYTES, { status: 200 })));

    const images = await getIssueImages(
      '![shot](https://gitlab.example.com/uploads/def/shot.png)',
    );

    expect(images).toHaveLength(1);
    expect(images[0].relPath).toBe('issue-images/shot.png');
  });

  it('skips an image hosted on a different origin', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const images = await getIssueImages('![external](https://evil.example/tracker.png)');

    expect(images).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('de-duplicates two images that would otherwise share a filename', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(PNG_BYTES, { status: 200 })));

    const images = await getIssueImages(
      '![a](/uploads/aaa/shot.png) ![b](/uploads/bbb/shot.png)',
    );

    expect(images.map((i) => i.relPath)).toEqual(['issue-images/shot.png', 'issue-images/1-shot.png']);
  });

  it('returns nothing when GitLab is not configured', async () => {
    stubSettings({ gitlabUrl: '', privateToken: '' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const images = await getIssueImages('![shot](/uploads/abc/shot.png)');

    expect(images).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
