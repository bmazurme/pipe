import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';

import {
  downloadFile as downloadFileRequest,
  listFiles as listFilesRequest,
  MAX_FILE_SIZE_BYTES,
  StoredFileMeta,
  uploadFile as uploadFileRequest,
} from '../api/storage';

interface StorageState {
  files: StoredFileMeta[];
  isLoading: boolean;
  isUploading: boolean;
  downloadingId: number | null;
  error: string | null;
}

const initialState: StorageState = {
  files: [],
  isLoading: true,
  isUploading: false,
  downloadingId: null,
  error: null,
};

// Cheap identity check so a poll that finds nothing new doesn't replace the
// array (and re-render the table) for no reason.
function sameFileIds(a: StoredFileMeta[], b: StoredFileMeta[]): boolean {
  return a.length === b.length && a.every((file, index) => file.id === b[index]?.id);
}

export const fetchFiles = createAsyncThunk<
  StoredFileMeta[],
  void,
  { rejectValue: string }
>('storage/fetchFiles', async (_, { rejectWithValue }) => {
  try {
    return await listFilesRequest();
  } catch {
    return rejectWithValue('Не удалось загрузить список файлов');
  }
});

// Background refresh that picks up files uploaded from another open
// device/tab. Never surfaces an error — a failed poll just tries again next
// tick — and returns null on failure so the reducer knows to leave state
// untouched instead of clobbering it with an empty list.
export const pollFiles = createAsyncThunk<StoredFileMeta[] | null>(
  'storage/pollFiles',
  async () => {
    try {
      return await listFilesRequest();
    } catch {
      return null;
    }
  },
);

export const uploadFile = createAsyncThunk<
  StoredFileMeta,
  File,
  { rejectValue: string }
>('storage/uploadFile', async (file, { rejectWithValue }) => {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return rejectWithValue(`«${file.name}» превышает лимит 10 МБ`);
  }

  try {
    return await uploadFileRequest(file);
  } catch (err) {
    return rejectWithValue(
      err instanceof Error ? err.message : 'Не удалось загрузить файл',
    );
  }
});

export const downloadFile = createAsyncThunk<
  number,
  StoredFileMeta,
  { rejectValue: string }
>('storage/downloadFile', async (file, { rejectWithValue }) => {
  try {
    await downloadFileRequest(file);
    return file.id;
  } catch {
    return rejectWithValue('Не удалось скачать файл');
  }
});

const storageSlice = createSlice({
  name: 'storage',
  initialState,
  reducers: {
    storageErrorDismissed: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchFiles.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(fetchFiles.fulfilled, (state, action) => {
        state.files = action.payload;
        state.isLoading = false;
      })
      .addCase(fetchFiles.rejected, (state, action) => {
        state.error = action.payload ?? 'Не удалось загрузить список файлов';
        state.isLoading = false;
      })
      .addCase(pollFiles.fulfilled, (state, action) => {
        if (action.payload && !sameFileIds(state.files, action.payload)) {
          state.files = action.payload;
        }
      })
      .addCase(uploadFile.pending, (state) => {
        state.isUploading = true;
        state.error = null;
      })
      .addCase(uploadFile.fulfilled, (state, action) => {
        state.files.unshift(action.payload);
        state.isUploading = false;
      })
      .addCase(uploadFile.rejected, (state, action) => {
        state.error = action.payload ?? 'Не удалось загрузить файл';
        state.isUploading = false;
      })
      .addCase(downloadFile.pending, (state, action) => {
        state.downloadingId = action.meta.arg.id;
        state.error = null;
      })
      .addCase(downloadFile.fulfilled, (state, action) => {
        state.files = state.files.filter((file) => file.id !== action.payload);
        state.downloadingId = null;
      })
      .addCase(downloadFile.rejected, (state, action) => {
        state.error = action.payload ?? 'Не удалось скачать файл';
        state.downloadingId = null;
      });
  },
});

export const { storageErrorDismissed } = storageSlice.actions;
export const storageReducer = storageSlice.reducer;
