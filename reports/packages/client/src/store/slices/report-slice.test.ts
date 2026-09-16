import { describe, it, expect } from 'vitest';

import reportReducer, { setReportState, defaultStateReport } from './report-slice';

describe('report slice', () => {
  it('replaces the state with the given payload', () => {
    const next = { month: '5' as const, year: '2026' };

    const state = reportReducer(defaultStateReport, setReportState(next));

    expect(state).toEqual(next);
  });
});
