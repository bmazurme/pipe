import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import type { RootState } from '../index';

export interface TimeState {
  year: number;
  reportYear: number;
  reportMonth: number;
}

// Only the calendar/day-offs year is remembered across reloads — the report
// tab's period is re-derived from whatever file gets imported next, so
// persisting it would just show a stale period until the next import.
export const TIME_YEAR_STORAGE_KEY = 'ntlstl-time-year';

function readStoredYear(fallback: number): number {
  try {
    const raw = window.localStorage.getItem(TIME_YEAR_STORAGE_KEY);
    const parsed = raw === null ? NaN : Number(raw);
    return Number.isInteger(parsed) ? parsed : fallback;
  } catch {
    // Storage unavailable (e.g. private browsing) — fall back silently.
    return fallback;
  }
}

const now = new Date();

const initialState: TimeState = {
  year: readStoredYear(now.getFullYear()),
  reportYear: now.getFullYear(),
  reportMonth: now.getMonth() + 1,
};

const timeSlice = createSlice({
  name: 'time',
  initialState,
  reducers: {
    yearChanged: (state, action: PayloadAction<number>) => {
      state.year = action.payload;
    },
    reportYearChanged: (state, action: PayloadAction<number>) => {
      state.reportYear = action.payload;
    },
    // Imported files carry their own period (parsed from the filename), so a
    // successful import jumps the tab straight to what was just imported.
    reportPeriodSet: (state, action: PayloadAction<{ year: number; month: number }>) => {
      state.reportYear = action.payload.year;
      state.reportMonth = action.payload.month;
    },
    // Stepping past January/December also rolls the year, same as a
    // physical calendar.
    reportMonthStepped: (state, action: PayloadAction<1 | -1>) => {
      const month = state.reportMonth + action.payload;
      if (month < 1) {
        state.reportYear -= 1;
        state.reportMonth = 12;
      } else if (month > 12) {
        state.reportYear += 1;
        state.reportMonth = 1;
      } else {
        state.reportMonth = month;
      }
    },
  },
});

export const { yearChanged, reportYearChanged, reportPeriodSet, reportMonthStepped } =
  timeSlice.actions;
export default timeSlice.reducer;
export const timeYearSelector = (state: RootState) => state.time.year;
export const timeReportYearSelector = (state: RootState) => state.time.reportYear;
export const timeReportMonthSelector = (state: RootState) => state.time.reportMonth;
