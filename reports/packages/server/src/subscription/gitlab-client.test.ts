import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { setSettings } from '../settings/props';
import { getIssueImages } from './gitlab-client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const settingsPath = join(__dirname, '..', 'settings', 'settings.json');

let originalContent: string | null;

beforeEach(() => {
  originalContent = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf-8') : null;
  setSettings({
    gitlabUrl: 'https://gitlab.example.com/api/v4',
    privateToken: 'token-123',
    userId: '',
    employee: '',
    company: '',
    bridgeApiUrl: '',
    bridgeApiKey: '',
    bridgeRefreshToken: '',
    bridgeStorageApiKey: '',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalContent === null) {
    rmSync(settingsPath, { force: true });
  } else {
    writeFileSync(settingsPath, originalContent);
  }
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
    setSettings({
      gitlabUrl: '',
      privateToken: '',
      userId: '',
      employee: '',
      company: '',
      bridgeApiUrl: '',
      bridgeApiKey: '',
      bridgeRefreshToken: '',
      bridgeStorageApiKey: '',
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const images = await getIssueImages('![shot](/uploads/abc/shot.png)');

    expect(images).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
