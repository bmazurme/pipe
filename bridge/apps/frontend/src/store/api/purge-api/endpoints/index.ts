import purgeApi from '..';

export interface PurgeEntry {
  id: number;
  key: string;
  value: string;
  createdAt: string;
}

function duplicateFieldMessage(data: unknown): string | undefined {
  const message = (data as { message?: string } | undefined)?.message;

  if (message?.startsWith('Key ')) return 'Такой ключ уже есть в словаре';
  if (message?.startsWith('Value ')) return 'Такое значение уже есть в словаре';
  return undefined;
}

const purgeApiEndpoints = purgeApi.injectEndpoints({
  endpoints: (builder) => ({
    listEntries: builder.query<PurgeEntry[], void>({
      query: () => 'purge',
      providesTags: ['Purge'],
    }),
    createEntry: builder.mutation<PurgeEntry, { key: string; value: string }>({
      query: (body) => ({ url: 'purge', method: 'POST', body }),
      invalidatesTags: ['Purge'],
      transformErrorResponse: (response) =>
        duplicateFieldMessage(response.data) ?? 'Не удалось добавить запись',
    }),
    updateEntry: builder.mutation<
      PurgeEntry,
      { id: number; key: string; value: string }
    >({
      query: ({ id, ...body }) => ({
        url: `purge/${id}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: ['Purge'],
      transformErrorResponse: (response) =>
        duplicateFieldMessage(response.data) ?? 'Не удалось сохранить изменения',
    }),
    deleteEntry: builder.mutation<void, number>({
      query: (id) => ({ url: `purge/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Purge'],
      transformErrorResponse: () => 'Не удалось удалить запись',
    }),
    // Draft text lives outside the `purge` tag — dictionary changes shouldn't
    // trigger a draft refetch and vice versa.
    getDraftText: builder.query<{ text: string }, void>({
      query: () => 'purge/draft/text',
    }),
    saveDraftText: builder.mutation<void, string>({
      query: (text) => ({
        url: 'purge/draft/text',
        method: 'PUT',
        body: { text },
      }),
    }),
  }),
});

export const {
  useListEntriesQuery,
  useCreateEntryMutation,
  useUpdateEntryMutation,
  useDeleteEntryMutation,
  useGetDraftTextQuery,
  useSaveDraftTextMutation,
} = purgeApiEndpoints;
export { purgeApiEndpoints };
