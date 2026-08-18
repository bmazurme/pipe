import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { DayOff, timeApiEndpoints } from '../api/time-api/endpoints';
import type { RootState } from '../index';

export interface TimeState {
  year: number;
  dayOffs: DayOff[];
}

const initialState: TimeState = {
  year: new Date().getFullYear(),
  dayOffs: [],
};

function sortByDate(dayOffs: DayOff[]): DayOff[] {
  return [...dayOffs].sort((a, b) => a.date.localeCompare(b.date));
}

const timeSlice = createSlice({
  name: 'time',
  initialState,
  reducers: {
    yearChanged: (state, action: PayloadAction<number>) => {
      state.year = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addMatcher(timeApiEndpoints.endpoints.listDayOffs.matchFulfilled, (state, action) => {
        state.dayOffs = action.payload;
      })
      .addMatcher(timeApiEndpoints.endpoints.createDayOff.matchFulfilled, (state, action) => {
        state.dayOffs = sortByDate([...state.dayOffs, action.payload]);
      })
      .addMatcher(timeApiEndpoints.endpoints.deleteDayOff.matchFulfilled, (state, action) => {
        state.dayOffs = state.dayOffs.filter(
          (dayOff) => dayOff.id !== action.meta.arg.originalArgs,
        );
      });
  },
});

export const { yearChanged } = timeSlice.actions;
export default timeSlice.reducer;
export const timeYearSelector = (state: RootState) => state.time.year;
export const timeDayOffsSelector = (state: RootState) => state.time.dayOffs;
