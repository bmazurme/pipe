import apiKeysApi from '..';

export interface ApiKey {
  id: number;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface CreatedApiKey extends ApiKey {
  token: string;
}

const apiKeysApiEndpoints = apiKeysApi.injectEndpoints({
  endpoints: (builder) => ({
    listApiKeys: builder.query<ApiKey[], void>({
      query: () => 'auth/api-keys',
      providesTags: ['ApiKeys'],
    }),
    createApiKey: builder.mutation<CreatedApiKey, string>({
      query: (name) => ({ url: 'auth/api-keys', method: 'POST', body: { name } }),
      invalidatesTags: ['ApiKeys'],
    }),
    revokeApiKey: builder.mutation<void, number>({
      query: (id) => ({ url: `auth/api-keys/${id}`, method: 'DELETE' }),
      invalidatesTags: ['ApiKeys'],
    }),
  }),
});

export const { useListApiKeysQuery, useCreateApiKeyMutation, useRevokeApiKeyMutation } = apiKeysApiEndpoints;
export { apiKeysApiEndpoints };
