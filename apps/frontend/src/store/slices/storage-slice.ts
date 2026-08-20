import { createSlice } from '@reduxjs/toolkit';

import { storageApiEndpoints, StoredFileMeta } from '../api/storage-api/endpoints';
import type { RootState } from '../index';

export interface StorageState {
  files: StoredFileMeta[];
}

const initialState: StorageState = {
  files: [],
};

const storageSlice = createSlice({
  name: 'storage',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addMatcher(storageApiEndpoints.endpoints.listFiles.matchFulfilled, (state, action) => {
        state.files = action.payload;
      })
      // Uploads don't go through RTK Query (they need XHR progress), so a
      // finished batch lands here via the Storage tag invalidation that
      // refetches listFiles — there's no upload action to match on.
      .addMatcher(storageApiEndpoints.endpoints.downloadFile.matchFulfilled, (state, action) => {
        state.files = state.files.filter((file) => file.id !== action.payload);
      });
  },
});

export default storageSlice.reducer;
export const storageFilesSelector = (state: RootState) => state.storage.files;
