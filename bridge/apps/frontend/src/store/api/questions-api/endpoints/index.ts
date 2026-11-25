import questionsApi from '..';

export interface QuestionItem {
  id: number;
  text: string;
  resolved: boolean;
  answer: string | null;
  /** The run the question came from, if known. */
  jobId: number | null;
  createdAt: string;
}

/** All the open questions of one task. Archived = every question ticked off. */
export interface QuestionCard {
  taskKey: string;
  /** The tag: the project number, or null for a task that has none. */
  project: string | null;
  questions: QuestionItem[];
  openCount: number;
  archived: boolean;
  updatedAt: string;
}

const questionsApiEndpoints = questionsApi.injectEndpoints({
  endpoints: (builder) => ({
    listQuestionCards: builder.query<QuestionCard[], { archived: boolean }>({
      query: ({ archived }) => `questions?archived=${archived}`,
      providesTags: ['Questions'],
    }),
    // The card's answered questions become a Context (named after the task) to attach to the next run.
    saveQuestionsAsContext: builder.mutation<{ contextId: number; updated: boolean }, { taskKey: string }>({
      query: ({ taskKey }) => ({ url: `questions/cards/${encodeURIComponent(taskKey)}/context`, method: 'POST' }),
    }),
    // Ticking the last open question moves the card to the archive, so both lists are refetched.
    setQuestionResolved: builder.mutation<QuestionItem, { id: number; resolved?: boolean; answer?: string }>({
      query: ({ id, ...body }) => ({ url: `questions/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Questions'],
    }),
    // One question, or (below) the whole card; the card leaves both lists when its last question goes.
    deleteQuestion: builder.mutation<void, number>({
      query: (id) => ({ url: `questions/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Questions'],
    }),
    deleteQuestionCard: builder.mutation<void, { taskKey: string }>({
      query: ({ taskKey }) => ({ url: `questions/cards/${encodeURIComponent(taskKey)}`, method: 'DELETE' }),
      invalidatesTags: ['Questions'],
    }),
  }),
});

export const {
  useListQuestionCardsQuery,
  useSetQuestionResolvedMutation,
  useSaveQuestionsAsContextMutation,
  useDeleteQuestionMutation,
  useDeleteQuestionCardMutation,
} = questionsApiEndpoints;
export { questionsApiEndpoints };
