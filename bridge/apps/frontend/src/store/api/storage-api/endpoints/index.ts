import storageApi from '..';

// Mirrors the backend's multer limit (apps/backend/src/storage/config/multer.config.ts).
export const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024;
export const MAX_FILE_SIZE_MB = MAX_FILE_SIZE_BYTES / (1024 * 1024);

export interface StoredFileMeta {
  id: number;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

const storageApiEndpoints = storageApi.injectEndpoints({
  endpoints: (builder) => ({
    listFiles: builder.query<StoredFileMeta[], void>({
      query: () => 'storage',
      providesTags: ['Storage'],
    }),
    // Uploads deliberately don't live here: fetchBaseQuery can't report
    // upload progress, and at a 200 MB limit that progress isn't optional.
    // See pages/storage/uploadWithProgress.ts — it posts to this same
    // endpoint over XHR and invalidates the Storage tag itself.

    // Non-destructive raw-bytes read (the backend's /peek, not /download —
    // that one deletes on success). Backs the Worker page's client-side
    // decrypt-before-job-creation flow: it needs the file's bytes while
    // leaving the Storage entry in place, since the user is about to turn
    // around and reference the same file as a job's source.
    peekFile: builder.mutation<Blob, number>({
      query: (id) => ({
        url: `storage/${id}/peek`,
        responseHandler: (response: Response) => response.blob(),
      }),
    }),

    // The backend deletes the file as part of serving the download, so a
    // successful response also means it's gone — the resolved id lets the
    // slice drop it from the local list immediately.
    downloadFile: builder.mutation<number, StoredFileMeta>({
      query: (file) => ({
        url: `storage/${file.id}/download`,
        responseHandler: (response: Response) => response.blob(),
      }),
      transformResponse: (blob: Blob, _meta, file) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = file.originalName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        return file.id;
      },
      invalidatesTags: ['Storage'],
    }),
  }),
});

export const { useListFilesQuery, usePeekFileMutation, useDownloadFileMutation } = storageApiEndpoints;
export { storageApiEndpoints };
