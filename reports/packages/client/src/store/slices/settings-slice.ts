import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { RootState } from '..';

export interface SettingsState {
  gitlabUrl: string;
  privateToken: string;
  userId: string;
  employee: string;
  company: string;
  bridgeApiUrl: string;
  bridgeApiKey: string;
}

const STORAGE_KEY = 'settings';

const initialSettings: SettingsState = {
  gitlabUrl: '',
  privateToken: '',
  userId: '',
  employee: '',
  company: '',
  bridgeApiUrl: '',
  bridgeApiKey: '',
};

const loadState = (): SettingsState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (raw) {
      return { ...initialSettings, ...JSON.parse(raw) as SettingsState };
    }
  } catch {
    // ignore malformed storage
  }

  return initialSettings;
};

export const initialStateSettings: SettingsState = loadState();

const settingsSlice = createSlice({
  name: 'settings',
  initialState: initialStateSettings,
  reducers: {
    setSettings: (_state, action: PayloadAction<SettingsState>) => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(action.payload));

      return action.payload;
    },
  },
});

export const { setSettings } = settingsSlice.actions;
export default settingsSlice.reducer;
export const settingsSelector = (state: RootState) => state.settings;
