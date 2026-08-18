import { createSlice } from '@reduxjs/toolkit';

import { Session, sessionsApiEndpoints } from '../api/sessions-api/endpoints';
import type { RootState } from '../index';

export interface SessionsState {
  sessions: Session[];
}

const initialState: SessionsState = {
  sessions: [],
};

const sessionsSlice = createSlice({
  name: 'sessions',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addMatcher(sessionsApiEndpoints.endpoints.listSessions.matchFulfilled, (state, action) => {
        state.sessions = action.payload;
      })
      .addMatcher(sessionsApiEndpoints.endpoints.revokeSession.matchFulfilled, (state, action) => {
        state.sessions = state.sessions.filter(
          (session) => session.id !== action.meta.arg.originalArgs,
        );
      });
  },
});

export default sessionsSlice.reducer;
export const sessionsSelector = (state: RootState) => state.sessions.sessions;
