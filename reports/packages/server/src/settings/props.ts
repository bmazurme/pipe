import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeJsonFileSync } from '@pipe/protocol';
import type { SettingsType } from '@reports/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const settingsPath = join(__dirname, 'settings.json');

const defaultSettings: SettingsType = {
  gitlabUrl: '',
  privateToken: '',
  userId: '',
  employee: '',
  company: '',
  bridgeApiUrl: '',
  bridgeApiKey: '',
};

export const getSettings = (): SettingsType => {
  if (!existsSync(settingsPath)) {
    return defaultSettings;
  }

  const { bridgeStorageApiKey, ...stored } = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Partial<SettingsType> & {
    bridgeStorageApiKey?: string;
  };

  // Until the single-key change there were two fields holding personal bridge API keys; the storage one was the one the
  // parcel flow and the autopilot used, so it wins when both are present. The next save drops it from the file.
  return { ...defaultSettings, ...stored, bridgeApiKey: bridgeStorageApiKey || stored.bridgeApiKey || '' };
};

export const setSettings = (settings: SettingsType): SettingsType => {
  // Owner-only: holds the GitLab token and bridge API keys (same reasoning as sync/src/credentials.ts).
  writeJsonFileSync(settingsPath, settings, { mode: 0o600 });

  return settings;
};
