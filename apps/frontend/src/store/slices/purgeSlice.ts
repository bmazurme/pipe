import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';

import {
  createEntry as createEntryRequest,
  deleteEntry as deleteEntryRequest,
  getDraftText as getDraftTextRequest,
  listEntries as listEntriesRequest,
  PurgeEntry,
  saveDraftText as saveDraftTextRequest,
  updateEntry as updateEntryRequest,
} from '../api/purge';

interface PurgeState {
  entries: PurgeEntry[];
  isEntriesLoading: boolean;
  entriesError: string | null;
  text: string;
  // What we know the backend currently holds. PurgePage derives its "unsent
  // local edit" guard as `text !== lastSyncedText` instead of tracking a
  // separate pending flag.
  lastSyncedText: string;
}

const initialState: PurgeState = {
  entries: [],
  isEntriesLoading: true,
  entriesError: null,
  text: '',
  lastSyncedText: '',
};

function sortByKey(entries: PurgeEntry[]): PurgeEntry[] {
  return [...entries].sort((a, b) => a.key.localeCompare(b.key));
}

export const fetchEntries = createAsyncThunk<
  PurgeEntry[],
  void,
  { rejectValue: string }
>('purge/fetchEntries', async (_, { rejectWithValue }) => {
  try {
    return await listEntriesRequest();
  } catch {
    return rejectWithValue('Не удалось загрузить словарь');
  }
});

export const createEntry = createAsyncThunk<
  PurgeEntry,
  { key: string; value: string },
  { rejectValue: string }
>('purge/createEntry', async ({ key, value }, { rejectWithValue }) => {
  try {
    return await createEntryRequest(key, value);
  } catch (err) {
    return rejectWithValue(
      err instanceof Error ? err.message : 'Не удалось добавить запись',
    );
  }
});

export const updateEntry = createAsyncThunk<
  PurgeEntry,
  { id: number; key: string; value: string },
  { rejectValue: string }
>('purge/updateEntry', async ({ id, key, value }, { rejectWithValue }) => {
  try {
    return await updateEntryRequest(id, key, value);
  } catch (err) {
    return rejectWithValue(
      err instanceof Error ? err.message : 'Не удалось сохранить изменения',
    );
  }
});

export const deleteEntry = createAsyncThunk<
  number,
  number,
  { rejectValue: string }
>('purge/deleteEntry', async (id, { rejectWithValue }) => {
  try {
    await deleteEntryRequest(id);
    return id;
  } catch {
    return rejectWithValue('Не удалось удалить запись');
  }
});

// Plain GET/PUT wrappers — the load-with-local-fallback logic and the
// debounce/poll scheduling around them stay in PurgePage, since they're
// about this component's lifecycle, not shared app data.
export const fetchDraftText = createAsyncThunk('purge/fetchDraftText', async () => {
  return getDraftTextRequest();
});

export const saveDraftText = createAsyncThunk(
  'purge/saveDraftText',
  async (text: string) => {
    await saveDraftTextRequest(text);
  },
);

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
      .addCase(fetchEntries.pending, (state) => {
        state.isEntriesLoading = true;
      })
      .addCase(fetchEntries.fulfilled, (state, action) => {
        state.entries = action.payload;
        state.isEntriesLoading = false;
      })
      .addCase(fetchEntries.rejected, (state, action) => {
        state.entriesError = action.payload ?? 'Не удалось загрузить словарь';
        state.isEntriesLoading = false;
      })
      .addCase(createEntry.fulfilled, (state, action) => {
        state.entries = sortByKey([...state.entries, action.payload]);
      })
      .addCase(updateEntry.fulfilled, (state, action) => {
        state.entries = sortByKey(
          state.entries.map((entry) =>
            entry.id === action.payload.id ? action.payload : entry,
          ),
        );
      })
      .addCase(deleteEntry.fulfilled, (state, action) => {
        state.entries = state.entries.filter((entry) => entry.id !== action.payload);
      })
      .addCase(fetchDraftText.fulfilled, (state, action) => {
        state.text = action.payload;
        state.lastSyncedText = action.payload;
      })
      .addCase(saveDraftText.fulfilled, (state, action) => {
        state.lastSyncedText = action.meta.arg;
      });
  },
});

export const { draftTextChanged } = purgeSlice.actions;
export const purgeReducer = purgeSlice.reducer;
