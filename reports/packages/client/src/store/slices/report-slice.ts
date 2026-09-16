import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { MonthKeyType } from '@reports/shared';

import type { RootState } from '..';

export interface ReportState {
  month: MonthKeyType;
  year: string;
}

export const defaultStateReport: ReportState = {
  month: '12',
  year: '2025',
};

const getInitialStateReport = (): ReportState => {
  try {
    const stored = localStorage.getItem('report');

    return stored ? { ...defaultStateReport, ...JSON.parse(stored) } : defaultStateReport;
  } catch {
    return defaultStateReport;
  }
};

export const initialStateReport: ReportState = getInitialStateReport();

const reportSlice = createSlice({
  name: 'report',
  initialState: initialStateReport,
  reducers: {
    setReportState: (_state, action: PayloadAction<ReportState>) => action.payload,
  },
});

export const { setReportState } = reportSlice.actions;
export default reportSlice.reducer;
export const reportSelector = (state: RootState) => state.report;
