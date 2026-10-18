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

const { getIssueImages, addIssueNote, setIssueTimeEstimate } = await import('./gitlab-client');

function stubSettings(overrides: Partial<SettingsType> = {}) {
  getSettingsMock.mockReturnValue({
    gitlabUrl: 'https://gitlab.example.com/api/v4',
    privateToken: 'token-123',
    userId: '',
    employee: '',
    company: '',
    bridgeApiUrl: '',
    bridgeApiKey: '',
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

// The download logic itself is tested in @pipe/protocol's gitlabClient.test.ts —
// these only cover what reports' wrapper adds: Settings as the source of
// apiUrl/token and the Russian warning lines.
describe('getIssueImages', () => {
  it('downloads with the apiUrl and token from Settings', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(PNG_BYTES, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const images = await getIssueImages('See: ![screenshot](/uploads/abc/screenshot.png)');

    expect(images).toEqual([{ relPath: 'issue-images/screenshot.png', base64: Buffer.from(PNG_BYTES).toString('base64') }]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://gitlab.example.com/uploads/abc/screenshot.png',
      expect.objectContaining({ headers: expect.objectContaining({ 'Private-Token': 'token-123' }) }),
    );
  });

  it('returns nothing when GitLab is not configured', async () => {
    stubSettings({ gitlabUrl: '', privateToken: '' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const images = await getIssueImages('![shot](/uploads/abc/shot.png)');

    expect(images).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('warns in Russian with the translated error and continues when a download fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404 })));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const images = await getIssueImages('![shot](/uploads/abc/shot.png)');

      expect(images).toEqual([]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toBe(
        'Не удалось скачать изображение из описания issue (https://gitlab.example.com/uploads/abc/shot.png):',
      );
      expect((warnSpy.mock.calls[0][1] as Error).message).toBe('GitLab API вернул ошибку 404: nope');
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('getIssueImages — refusing to send the token off-instance', () => {
  it.each([
    ['a look-alike host with the instance as a prefix', '![x](https://gitlab.example.com.evil.net/uploads/a.png)'],
    ['the instance as userinfo in front of another host', '![x](https://gitlab.example.com@evil.net/uploads/a.png)'],
    ['a same-instance path outside /uploads/', '![x](https://gitlab.example.com/api/v4/user)'],
    ['a relative path outside /uploads/', '![x](/api/v4/user)'],
  ])('makes no request for %s', async (_label, description) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const images = await getIssueImages(description);

    expect(images).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not follow a redirect and skips the image', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 302, headers: { Location: 'https://evil.net/steal' } }));
    vi.stubGlobal('fetch', fetchMock);

    const images = await getIssueImages('![shot](/uploads/abc/shot.png)');

    expect(images).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://gitlab.example.com/uploads/abc/shot.png',
      expect.objectContaining({ redirect: 'manual' }),
    );
  });
});

describe('write helpers encode route params', () => {
  it('addIssueNote never lets iid escape the issue path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal('fetch', fetchMock);

    await addIssueNote('1', '../../projects/999/issues/5', 'x');

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://gitlab.example.com/api/v4/projects/1/issues/..%2F..%2Fprojects%2F999%2Fissues%2F5/notes',
    );
  });

  it('setIssueTimeEstimate encodes projectId and iid', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal('fetch', fetchMock);

    await setIssueTimeEstimate('a/b', '5?x#y', '1h');

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://gitlab.example.com/api/v4/projects/a%2Fb/issues/5%3Fx%23y/time_estimate?duration=1h',
    );
  });
});
