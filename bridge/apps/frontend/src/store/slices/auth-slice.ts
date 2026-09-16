import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { authApiEndpoints } from '../api/auth-api/endpoints';
import type { RootState } from '../index';

export interface AuthState {
  accessToken: string | null;
  isAuthenticated: boolean;
}

const initialState: AuthState = {
  accessToken: null,
  isAuthenticated: false,
};

// Deliberately minimal and free of any dependency on a reauth-based api
// (users-api, storage-api, ...): base-query-with-reauth.ts dispatches these
// actions, so if this slice pulled in one of those apis it would close a
// circular import back on itself.
const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials: (state, action: PayloadAction<{ accessToken: string }>) => {
      state.accessToken = action.payload.accessToken;
      state.isAuthenticated = true;
    },
    logout: (state) => {
      state.accessToken = null;
      state.isAuthenticated = false;
    },
  },
  extraReducers: (builder) => {
    builder
      .addMatcher(authApiEndpoints.endpoints.checkAuth.matchFulfilled, (state, action) => {
        state.isAuthenticated = action.payload.isAuthenticated;
        if (action.payload.accessToken) {
          state.accessToken = action.payload.accessToken;
        }
      })
      .addMatcher(authApiEndpoints.endpoints.checkAuth.matchRejected, (state) => {
        state.isAuthenticated = false;
      })
      .addMatcher(authApiEndpoints.endpoints.logout.matchFulfilled, (state) => {
        state.accessToken = null;
        state.isAuthenticated = false;
      });
  },
});

export const { setCredentials, logout } = authSlice.actions;
export default authSlice.reducer;
export const authSelector = (state: RootState) => state.auth;
