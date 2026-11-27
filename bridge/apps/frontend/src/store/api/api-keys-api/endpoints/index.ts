import apiKeysApi from '..';

/** What a key is limited to; no scope = a full key. */
export type ApiKeyScope = 'boards' | 'readonly' | 'reports-sync';

export interface ApiKey {
  id: number;
  name: string;
  prefix: string;
  scope?: ApiKeyScope | null;
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
    // expiresInDays: not sent = the server's default (90 days); null = never expires, asked for on purpose.
    createApiKey: builder.mutation<CreatedApiKey, { name: string; scope?: ApiKeyScope; expiresInDays?: ApiKeyExpiryDays | null }>({
      query: ({ name, scope, expiresInDays }) => ({
        url: 'auth/api-keys',
        method: 'POST',
        body: { name, ...(scope ? { scope } : {}), ...(expiresInDays !== undefined ? { expiresInDays } : {}) },
      }),
      invalidatesTags: ['ApiKeys'],
    }),
    // The same key again with a new secret; the server checks the old one is dead before it answers.
    rotateApiKey: builder.mutation<CreatedApiKey, number>({
      query: (id) => ({ url: `auth/api-keys/${id}/rotate`, method: 'POST' }),
      invalidatesTags: ['ApiKeys'],
    }),
    revokeApiKey: builder.mutation<void, number>({
      query: (id) => ({ url: `auth/api-keys/${id}`, method: 'DELETE' }),
      invalidatesTags: ['ApiKeys'],
    }),
  }),
});

export const { useListApiKeysQuery, useCreateApiKeyMutation, useRotateApiKeyMutation, useRevokeApiKeyMutation } = apiKeysApiEndpoints;
export { apiKeysApiEndpoints };
