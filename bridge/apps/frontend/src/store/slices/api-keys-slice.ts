import { createSlice } from '@reduxjs/toolkit';

import { ApiKey, apiKeysApiEndpoints } from '../api/api-keys-api/endpoints';
import type { RootState } from '../index';

export interface ApiKeysState {
  apiKeys: ApiKey[];
}

const initialState: ApiKeysState = {
  apiKeys: [],
};

// Deliberately does not mirror createApiKey's result here: that response
// carries the plaintext token, and this slice's job is the long-lived list
// view — the token is shown once, from the mutation's own return value, and
// then never persisted anywhere in the store.
const apiKeysSlice = createSlice({
  name: 'apiKeys',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addMatcher(apiKeysApiEndpoints.endpoints.listApiKeys.matchFulfilled, (state, action) => {
        state.apiKeys = action.payload;
      })
      .addMatcher(apiKeysApiEndpoints.endpoints.revokeApiKey.matchFulfilled, (state, action) => {
        state.apiKeys = state.apiKeys.filter((apiKey) => apiKey.id !== action.meta.arg.originalArgs);
      });
  },
});

export default apiKeysSlice.reducer;
export const apiKeysSelector = (state: RootState) => state.apiKeys.apiKeys;
