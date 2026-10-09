import contextApi from '..';

/** What a list shows — never the text (fetch one context with useGetContextQuery). */
export interface ContextSummary {
  id: number;
  name: string;
  /** Characters in the text; null for a context saved before the size was recorded. */
  contentLength: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SavedContext extends Omit<ContextSummary, 'contentLength'> {
  content: string;
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
    listContexts: builder.query<ContextSummary[], void>({
      query: () => 'contexts',
      providesTags: ['Context'],
    }),
    // One context with its text, fetched when it is opened for editing.
    getContext: builder.query<SavedContext, number>({
      query: (id) => `contexts/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'Context', id }],
    }),
    createContext: builder.mutation<SavedContext, { name: string; content: string }>({
      query: (body) => ({ url: 'contexts', method: 'POST', body }),
      invalidatesTags: ['Context'],
      transformErrorResponse: (response) => duplicateNameMessage(response.data) ?? 'Не удалось сохранить контекст',
    }),
    updateContext: builder.mutation<SavedContext, { id: number; name?: string; content?: string }>({
      query: ({ id, ...body }) => ({ url: `contexts/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_result, _error, { id }) => ['Context', { type: 'Context', id }],
      transformErrorResponse: (response) => duplicateNameMessage(response.data) ?? 'Не удалось сохранить изменения',
    }),
    deleteContext: builder.mutation<void, number>({
      query: (id) => ({ url: `contexts/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Context'],
      transformErrorResponse: () => 'Не удалось удалить контекст',
    }),
  }),
});

export const { useListContextsQuery, useGetContextQuery, useCreateContextMutation, useUpdateContextMutation, useDeleteContextMutation } = contextApiEndpoints;
export { contextApiEndpoints };
