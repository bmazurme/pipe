import type { FetchBaseQueryError } from '@reduxjs/toolkit/query';

import storageApi from '..';

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

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
    // A custom queryFn so the 10 MB check happens before anything hits the
    // network, and a 413 from the server still resolves to the same
    // friendly message either way.
    uploadFile: builder.mutation<StoredFileMeta, File>({
      queryFn: async (file, _queryApi, _extraOptions, fetchWithBQ) => {
        if (file.size > MAX_FILE_SIZE_BYTES) {
          return {
            error: {
              status: 'CUSTOM_ERROR',
              error: `«${file.name}» превышает лимит 10 МБ`,
            } as FetchBaseQueryError,
          };
        }

        const formData = new FormData();
        formData.append('file', file);
        const result = await fetchWithBQ({
          url: 'storage',
          method: 'POST',
          body: formData,
        });

        if (result.error) {
          const message =
            result.error.status === 413
              ? 'Файл превышает лимит 10 МБ'
              : 'Не удалось загрузить файл';
          return {
            error: { status: 'CUSTOM_ERROR', error: message } as FetchBaseQueryError,
          };
        }

        return { data: result.data as StoredFileMeta };
      },
      invalidatesTags: ['Storage'],
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

export const {
  useListFilesQuery,
  useUploadFileMutation,
  useDownloadFileMutation,
} = storageApiEndpoints;
export { storageApiEndpoints };
