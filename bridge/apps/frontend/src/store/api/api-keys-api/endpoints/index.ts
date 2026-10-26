import apiKeysApi from '..';

export interface ApiKey {
  id: number;
  name: string;
  prefix: string;
  scope?: 'boards' | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt?: string | null;
}

export type ApiKeyExpiryDays = 30 | 90 | 365;

export interface CreatedApiKey extends ApiKey {
  token: string;
}

const apiKeysApiEndpoints = apiKeysApi.injectEndpoints({
  endpoints: (builder) => ({
    listApiKeys: builder.query<ApiKey[], void>({
      query: () => 'auth/api-keys',
      providesTags: ['ApiKeys'],
    }),
    createApiKey: builder.mutation<CreatedApiKey, { name: string; scope?: 'boards'; expiresInDays?: ApiKeyExpiryDays }>({
      query: ({ name, scope, expiresInDays }) => ({
        url: 'auth/api-keys',
        method: 'POST',
        body: { name, ...(scope ? { scope } : {}), ...(expiresInDays ? { expiresInDays } : {}) },
      }),
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
