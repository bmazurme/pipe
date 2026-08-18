import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { PurgeEntry, purgeApiEndpoints } from '../api/purge-api/endpoints';
import type { RootState } from '../index';

export interface PurgeState {
  entries: PurgeEntry[];
  text: string;
  // What we know the backend currently holds. PurgePage derives its "unsent
  // local edit" guard as `text !== lastSyncedText` instead of tracking a
  // separate pending flag.
  lastSyncedText: string;
}

const initialState: PurgeState = {
  entries: [],
  text: '',
  lastSyncedText: '',
};

function sortByKey(entries: PurgeEntry[]): PurgeEntry[] {
  return [...entries].sort((a, b) => a.key.localeCompare(b.key));
}

const purgeSlice = createSlice({
  name: 'purge',
  initialState,
  reducers: {
    draftTextChanged: (state, action: PayloadAction<string>) => {
      state.text = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addMatcher(purgeApiEndpoints.endpoints.listEntries.matchFulfilled, (state, action) => {
        state.entries = action.payload;
      })
      .addMatcher(purgeApiEndpoints.endpoints.createEntry.matchFulfilled, (state, action) => {
        state.entries = sortByKey([...state.entries, action.payload]);
      })
      .addMatcher(purgeApiEndpoints.endpoints.updateEntry.matchFulfilled, (state, action) => {
        state.entries = sortByKey(
          state.entries.map((entry) =>
            entry.id === action.payload.id ? action.payload : entry,
          ),
        );
      })
      .addMatcher(purgeApiEndpoints.endpoints.deleteEntry.matchFulfilled, (state, action) => {
        state.entries = state.entries.filter(
          (entry) => entry.id !== action.meta.arg.originalArgs,
        );
      })
      .addMatcher(purgeApiEndpoints.endpoints.getDraftText.matchFulfilled, (state, action) => {
        state.text = action.payload.text;
        state.lastSyncedText = action.payload.text;
      })
      .addMatcher(purgeApiEndpoints.endpoints.saveDraftText.matchFulfilled, (state, action) => {
        state.lastSyncedText = action.meta.arg.originalArgs;
      });
  },
});

export const { draftTextChanged } = purgeSlice.actions;
export default purgeSlice.reducer;
export const purgeEntriesSelector = (state: RootState) => state.purge.entries;
export const purgeTextSelector = (state: RootState) => state.purge.text;
export const purgeLastSyncedTextSelector = (state: RootState) =>
  state.purge.lastSyncedText;
