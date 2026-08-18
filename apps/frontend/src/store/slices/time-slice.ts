import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import type { RootState } from '../index';

export interface TimeState {
  year: number;
}

const initialState: TimeState = {
  year: new Date().getFullYear(),
};

const timeSlice = createSlice({
  name: 'time',
  initialState,
  reducers: {
    yearChanged: (state, action: PayloadAction<number>) => {
      state.year = action.payload;
    },
  },
});

export const { yearChanged } = timeSlice.actions;
export default timeSlice.reducer;
export const timeYearSelector = (state: RootState) => state.time.year;
