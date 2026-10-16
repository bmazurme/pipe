import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';

import { handleImportSettingsBundle } from './handler';
import { handlePullSettingsFromBridge } from './bridge-sync-handler';

const stored = {
  gitlabUrl: 'https://gitlab.com/api/v4',
  privateToken: 'glpat-real',
  bridgeApiUrl: 'https://bridge.example',
  bridgeApiKey: 'bridge-key-real',
  bridgeStorageApiKey: 'storage-key-real',
};

vi.mock('./props', () => ({
  getSettings: vi.fn(() => stored),
  setSettings: vi.fn((s) => s),
}));

vi.mock('./bundle', () => ({
  buildSettingsBundle: vi.fn(),
  applySettingsBundle: vi.fn(() => ({ skippedYears: ['2020'] })),
}));

const fakeRes = () => {
  const chunks: string[] = [];
  const res = {
    setHeader: vi.fn(),
    write: vi.fn((chunk: string) => chunks.push(chunk)),
    end: vi.fn(),
  };

  return { res: res as unknown as Response, output: () => chunks.join('') };
};

const expectOnlySkippedYears = (output: string) => {
  for (const secret of ['glpat-real', 'bridge-key-real', 'storage-key-real']) {
    expect(output).not.toContain(secret);
  }

  expect(JSON.parse(output.trim())).toEqual({ type: 'message', data: { skippedYears: ['2020'] } });
};

describe('settings handlers never echo stored secrets', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('import replies with skippedYears only', async () => {
    const { res, output } = fakeRes();

    await handleImportSettingsBundle({ body: {} } as Request, res);

    expectOnlySkippedYears(output());
  });

  it('bridge pull replies with skippedYears only', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ updatedAt: 'now', payload: '{}' }), { status: 200 })),
    );
    const { res, output } = fakeRes();

    await handlePullSettingsFromBridge({ body: {} } as Request, res);

    expectOnlySkippedYears(output());
  });
});
