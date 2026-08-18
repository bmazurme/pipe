import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';

import { checkAuth, logout as logoutRequest } from '../api/auth';
import { tokenStore } from '../api/token-store';
import { fetchMe, Me, updateUser } from '../api/users';

interface AuthState {
  user: Me | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

const initialState: AuthState = {
  user: null,
  isAuthenticated: false,
  isLoading: true,
};

// Runs once on app start: exchanges the refresh cookie for an access token
// (if the browser has a valid session) and loads the current user. A thrown
// error here still resolves to the rejected case below, so isLoading always
// settles to false even if checkAuth itself fails.
export const initAuth = createAsyncThunk('auth/init', async () => {
  const result = await checkAuth();

  if (result.isAuthenticated && result.accessToken) {
    tokenStore.set(result.accessToken);

    try {
      const user = await fetchMe();
      return { isAuthenticated: true, user };
    } catch {
      return { isAuthenticated: false, user: null };
    }
  }

  return { isAuthenticated: false, user: null };
});

export const logout = createAsyncThunk('auth/logout', async () => {
  await logoutRequest();
  tokenStore.set(null);
});

export const refreshUser = createAsyncThunk('auth/refreshUser', async () => {
  return fetchMe();
});

export const updateUserStatus = createAsyncThunk(
  'auth/updateUserStatus',
  async ({ id, status }: { id: number; status: string }) => {
    await updateUser(id, { status });
  },
);

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(initAuth.fulfilled, (state, action) => {
        state.isAuthenticated = action.payload.isAuthenticated;
        state.user = action.payload.user;
        state.isLoading = false;
      })
      .addCase(initAuth.rejected, (state) => {
        state.isAuthenticated = false;
        state.user = null;
        state.isLoading = false;
      })
      .addCase(logout.fulfilled, (state) => {
        state.user = null;
        state.isAuthenticated = false;
      })
      .addCase(refreshUser.fulfilled, (state, action) => {
        state.user = action.payload;
      });
  },
});

export const authReducer = authSlice.reducer;
