import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { SettingsType } from '@reports/shared';

import { getSettings, setSettings } from './props';

const __dirname = dirname(fileURLToPath(import.meta.url));
const settingsPath = join(__dirname, 'settings.json');

let originalContent: string | null;

beforeEach(() => {
  originalContent = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf-8') : null;
});

afterEach(() => {
  if (originalContent === null) {
    rmSync(settingsPath, { force: true });
  } else {
    writeFileSync(settingsPath, originalContent);
  }
});

describe('getSettings', () => {
  it('returns the persisted settings', () => {
    const settings = getSettings();

    expect(settings).toHaveProperty('gitlabUrl');
    expect(settings).toHaveProperty('privateToken');
    expect(settings).toHaveProperty('userId');
    expect(settings).toHaveProperty('employee');
    expect(settings).toHaveProperty('company');
    expect(settings).toHaveProperty('bridgeApiUrl');
    expect(settings).toHaveProperty('bridgeApiKey');
  });

  it('falls back to empty defaults when the file does not exist', () => {
    rmSync(settingsPath, { force: true });

    expect(getSettings()).toEqual({
      gitlabUrl: '',
      privateToken: '',
      userId: '',
      employee: '',
      company: '',
      bridgeApiUrl: '',
      bridgeApiKey: '',
      bridgeRefreshToken: '',
    });
  });
});

describe('setSettings', () => {
  it('persists new settings and returns them', () => {
    const newSettings: SettingsType = {
      gitlabUrl: 'https://gitlab.example.com/api/v4',
      privateToken: 'token-123',
      userId: '42',
      employee: 'Test Employee',
      company: 'Test Company',
      bridgeApiUrl: 'http://localhost:3002/api/v1/time/export/day-offs',
      bridgeApiKey: 'bridge-key-123',
      bridgeRefreshToken: 'refresh-token-123',
    };

    const result = setSettings(newSettings);

    expect(result).toEqual(newSettings);
    expect(getSettings()).toEqual(newSettings);
  });
});
