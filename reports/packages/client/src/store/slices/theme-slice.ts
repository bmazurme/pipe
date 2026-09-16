import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { RootState } from '..';

export interface ThemeState {
  isDark: boolean;
}

const STORAGE_KEY = 'theme';

const prefersDark = (): boolean => {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return true;
  }
};

const loadState = (): ThemeState => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);

    if (stored === 'dark' || stored === 'light') {
      return { isDark: stored === 'dark' };
    }
  } catch {
    // localStorage unavailable (e.g. private mode) — fall back to the system theme
  }

  return { isDark: prefersDark() };
};

export const initialStateTheme: ThemeState = loadState();

const themeSlice = createSlice({
  name: 'theme',
  initialState: initialStateTheme,
  reducers: {
    setTheme: (state, action: PayloadAction<ThemeState>) => {
      state.isDark = action.payload.isDark;

      try {
        localStorage.setItem(STORAGE_KEY, action.payload.isDark ? 'dark' : 'light');
      } catch {
        // ignore write failures
      }
    },
  },
});

export const { setTheme } = themeSlice.actions;
export default themeSlice.reducer;
export const themeSelector = (state: RootState) => state.theme;
