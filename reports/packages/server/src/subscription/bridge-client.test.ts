import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SettingsType } from '@reports/shared';

const getSettingsMock = vi.fn<() => SettingsType>();
vi.mock('../settings/props', () => ({ getSettings: () => getSettingsMock() }));

const { uploadParcel, listParcels } = await import('./bridge-client');

function stubSettings(overrides: Partial<SettingsType> = {}) {
  getSettingsMock.mockReturnValue({
    gitlabUrl: '',
    privateToken: '',
    userId: '',
    employee: '',
    company: '',
    bridgeApiUrl: 'https://bridge.example.com',
    bridgeApiKey: '',
    bridgeStorageApiKey: 'brk_test',
    ...overrides,
  });
}

beforeEach(() => {
  stubSettings();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const STORED_FILE = {
  id: 1,
  originalName: '402-6.subscription.zip',
  mimeType: 'application/zip',
  size: 10,
  createdAt: '2026-10-04T00:00:00.000Z',
  channel: 'issue',
  taskKey: '402:6',
  direction: 'result' as const,
};

// IMPROVEMENTS_TECH.md 2.3: the reading side (handlePullSubscriptionIssue)
// now matches a parcel by this query string instead of its filename — these
// cover the query-building logic uploadParcel/listParcels add on top of the
// pre-existing plain upload/list.
describe('listParcels', () => {
  it('sends no query string when the filter is empty', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([STORED_FILE]));
    vi.stubGlobal('fetch', fetchMock);

    await listParcels();

    expect(fetchMock).toHaveBeenCalledWith('https://bridge.example.com/api/v1/storage', expect.anything());
  });

  it('builds a query string from channel/taskKey/direction', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([STORED_FILE]));
    vi.stubGlobal('fetch', fetchMock);

    await listParcels({ channel: 'issue', taskKey: '402:6', direction: 'result' });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://bridge.example.com/api/v1/storage?channel=issue&taskKey=402%3A6&direction=result');
  });

  it('returns the addressing fields on each parcel', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json([STORED_FILE])));

    const parcels = await listParcels({ taskKey: '402:6' });

    expect(parcels[0]).toMatchObject({ channel: 'issue', taskKey: '402:6', direction: 'result' });
  });
});

describe('uploadParcel', () => {
  it('uploads with no addressing fields when meta is omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(STORED_FILE));
    vi.stubGlobal('fetch', fetchMock);

    await uploadParcel(Buffer.from('x'), '402-6.subscription.zip');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const form = init.body as FormData;
    expect(form.get('channel')).toBeNull();
    expect(form.get('taskKey')).toBeNull();
    expect(form.get('direction')).toBeNull();
  });

  it('attaches channel/taskKey/direction to the multipart body when given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(STORED_FILE));
    vi.stubGlobal('fetch', fetchMock);

    await uploadParcel(Buffer.from('x'), '402-6.subscription.zip', {
      channel: 'issue',
      taskKey: '402:6',
      direction: 'outbound',
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const form = init.body as FormData;
    expect(form.get('channel')).toBe('issue');
    expect(form.get('taskKey')).toBe('402:6');
    expect(form.get('direction')).toBe('outbound');
  });
});
