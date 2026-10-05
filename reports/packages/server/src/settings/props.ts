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
  bridgeStorageApiKey: '',
};

export const getSettings = (): SettingsType => {
  if (!existsSync(settingsPath)) {
    return defaultSettings;
  }

  return { ...defaultSettings, ...JSON.parse(readFileSync(settingsPath, 'utf-8')) };
};

export const setSettings = (settings: SettingsType): SettingsType => {
  writeJsonFileSync(settingsPath, settings);

  return settings;
};
