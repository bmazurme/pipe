import secretsApi from '..';

export interface Secret {
  id: number;
  name: string;
  description: string | null;
  expiresOn: string | null;
  createdAt: string;
  updatedAt: string;
}

function duplicateNameMessage(data: unknown): string | undefined {
  const message = (data as { message?: string } | undefined)?.message;
  return message?.startsWith('A secret named') ? message : undefined;
}

const secretsApiEndpoints = secretsApi.injectEndpoints({
  endpoints: (builder) => ({
    listSecrets: builder.query<Secret[], void>({
      query: () => 'secrets',
      providesTags: ['Secret'],
    }),
    createSecret: builder.mutation<
      Secret,
      { name: string; value: string; description?: string; expiresOn?: string }
    >({
      query: (body) => ({ url: 'secrets', method: 'POST', body }),
      invalidatesTags: ['Secret'],
      transformErrorResponse: (response) =>
        duplicateNameMessage(response.data) ?? 'Не удалось сохранить секрет',
    }),
    updateSecret: builder.mutation<
      Secret,
      { id: number; name?: string; value?: string; description?: string; expiresOn?: string | null }
    >({
      query: ({ id, ...body }) => ({
        url: `secrets/${id}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: ['Secret'],
      transformErrorResponse: (response) =>
        duplicateNameMessage(response.data) ?? 'Не удалось сохранить изменения',
    }),
    deleteSecret: builder.mutation<void, number>({
      query: (id) => ({ url: `secrets/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Secret'],
      transformErrorResponse: () => 'Не удалось удалить секрет',
    }),
    // Lazy only (useLazy…) — never fired by loading the page; every click
    // re-fetches, nothing is kept in the cache.
    exportSecrets: builder.query<string, void>({
      query: () => ({ url: 'secrets/export', responseHandler: 'text' }),
      keepUnusedDataFor: 0,
    }),
    // Not tagged/cached — every click re-fetches the real current value
    // rather than ever serving a stale one back from RTK Query's cache.
    revealSecret: builder.mutation<{ value: string }, number>({
      query: (id) => ({ url: `secrets/${id}/value`, method: 'GET' }),
      transformErrorResponse: () => 'Не удалось получить значение секрета',
    }),
  }),
});

export const {
  useListSecretsQuery,
  useCreateSecretMutation,
  useUpdateSecretMutation,
  useDeleteSecretMutation,
  useRevealSecretMutation,
  useLazyExportSecretsQuery,
} = secretsApiEndpoints;
export { secretsApiEndpoints };
