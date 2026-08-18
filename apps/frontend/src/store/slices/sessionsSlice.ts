import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';

import {
  listSessions as listSessionsRequest,
  revokeSession as revokeSessionRequest,
  Session,
} from '../api/sessions';

interface SessionsState {
  sessions: Session[];
  isLoading: boolean;
  error: string | null;
  revokingId: number | null;
}

const initialState: SessionsState = {
  sessions: [],
  isLoading: true,
  error: null,
  revokingId: null,
};

export const fetchSessions = createAsyncThunk<
  Session[],
  void,
  { rejectValue: string }
>('sessions/fetchSessions', async (_, { rejectWithValue }) => {
  try {
    return await listSessionsRequest();
  } catch {
    return rejectWithValue('Не удалось загрузить список устройств');
  }
});

export const revokeSession = createAsyncThunk<
  number,
  number,
  { rejectValue: string }
>('sessions/revokeSession', async (id, { rejectWithValue }) => {
  try {
    await revokeSessionRequest(id);
    return id;
  } catch {
    return rejectWithValue('Не удалось завершить сеанс');
  }
});

const sessionsSlice = createSlice({
  name: 'sessions',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchSessions.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(fetchSessions.fulfilled, (state, action) => {
        state.sessions = action.payload;
        state.isLoading = false;
      })
      .addCase(fetchSessions.rejected, (state, action) => {
        state.error = action.payload ?? 'Не удалось загрузить список устройств';
        state.isLoading = false;
      })
      .addCase(revokeSession.pending, (state, action) => {
        state.revokingId = action.meta.arg;
        state.error = null;
      })
      .addCase(revokeSession.fulfilled, (state, action) => {
        state.sessions = state.sessions.filter(
          (session) => session.id !== action.payload,
        );
        state.revokingId = null;
      })
      .addCase(revokeSession.rejected, (state, action) => {
        state.error = action.payload ?? 'Не удалось завершить сеанс';
        state.revokingId = null;
      });
  },
});

export const sessionsReducer = sessionsSlice.reducer;
