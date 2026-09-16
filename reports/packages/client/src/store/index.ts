import { configureStore } from '@reduxjs/toolkit';

import { reportsApi } from './api/index';

import themeReducer from './slices/theme-slice';
import reportReducer from './slices/report-slice';
import settingsReducer from './slices/settings-slice';

export * from './slices/index';

export const store = configureStore({
  reducer: {
    theme: themeReducer,
    report: reportReducer,
    settings: settingsReducer,
    [reportsApi.reducerPath]: reportsApi.reducer,
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware()
    .concat(
      reportsApi.middleware,
    ),
});

let persistedReport = store.getState().report;

store.subscribe(() => {
  const { report } = store.getState();

  // API cache updates fire on every request — only touch storage when the slice really changed
  if (report === persistedReport) {
    return;
  }

  persistedReport = report;

  try {
    localStorage.setItem('report', JSON.stringify(report));
  } catch {
    // ignore write failures
  }
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
