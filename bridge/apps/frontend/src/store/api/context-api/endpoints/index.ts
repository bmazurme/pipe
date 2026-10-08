import contextApi from '..';

export interface SavedContext {
  id: number;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

// Mirrors the backend's limits (apps/backend/src/context/context.limits.ts).
export const MAX_CONTEXT_NAME_LENGTH = 100;
export const MAX_CONTEXT_LENGTH = 20_000;

function duplicateNameMessage(data: unknown): string | undefined {
  const message = (data as { message?: string } | undefined)?.message;

  return message?.startsWith('A context named') ? 'Контекст с таким названием уже есть' : undefined;
}

const contextApiEndpoints = contextApi.injectEndpoints({
  endpoints: (builder) => ({
    listContexts: builder.query<SavedContext[], void>({
      query: () => 'contexts',
      providesTags: ['Context'],
    }),
    createContext: builder.mutation<SavedContext, { name: string; content: string }>({
      query: (body) => ({ url: 'contexts', method: 'POST', body }),
      invalidatesTags: ['Context'],
      transformErrorResponse: (response) => duplicateNameMessage(response.data) ?? 'Не удалось сохранить контекст',
    }),
    updateContext: builder.mutation<SavedContext, { id: number; name?: string; content?: string }>({
      query: ({ id, ...body }) => ({ url: `contexts/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Context'],
      transformErrorResponse: (response) => duplicateNameMessage(response.data) ?? 'Не удалось сохранить изменения',
    }),
    deleteContext: builder.mutation<void, number>({
      query: (id) => ({ url: `contexts/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Context'],
      transformErrorResponse: () => 'Не удалось удалить контекст',
    }),
  }),
});

export const { useListContextsQuery, useCreateContextMutation, useUpdateContextMutation, useDeleteContextMutation } = contextApiEndpoints;
export { contextApiEndpoints };
