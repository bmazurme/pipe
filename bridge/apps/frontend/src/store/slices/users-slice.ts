import { createSlice } from '@reduxjs/toolkit';

import { authApiEndpoints } from '../api/auth-api/endpoints';
import { Me, usersApiEndpoints } from '../api/users-api/endpoints';
import type { RootState } from '../index';

export interface UsersState {
  user: Me | null;
  isLoading: boolean;
}

const initialState: UsersState = {
  user: null,
  isLoading: true,
};

const usersSlice = createSlice({
  name: 'users',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addMatcher(authApiEndpoints.endpoints.checkAuth.matchFulfilled, (state, action) => {
        // Not authenticated is the final answer on its own — authenticated
        // still needs getMe (triggered by AuthProvider once isAuthenticated
        // flips) before isLoading can settle.
        if (!action.payload.isAuthenticated) {
          state.user = null;
          state.isLoading = false;
        }
      })
      .addMatcher(authApiEndpoints.endpoints.checkAuth.matchRejected, (state) => {
        state.user = null;
        state.isLoading = false;
      })
      .addMatcher(usersApiEndpoints.endpoints.getMe.matchFulfilled, (state, action) => {
        state.user = action.payload;
        state.isLoading = false;
      })
      .addMatcher(usersApiEndpoints.endpoints.getMe.matchRejected, (state) => {
        state.user = null;
        state.isLoading = false;
      })
      .addMatcher(authApiEndpoints.endpoints.logout.matchFulfilled, (state) => {
        state.user = null;
      });
  },
});

export default usersSlice.reducer;
export const usersSelector = (state: RootState) => state.users.user;
export const usersLoadingSelector = (state: RootState) => state.users.isLoading;
