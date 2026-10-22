import questionsApi from '..';

export interface QuestionItem {
  id: number;
  text: string;
  resolved: boolean;
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
    // Ticking the last open question moves the card to the archive, so both lists are refetched.
    setQuestionResolved: builder.mutation<QuestionItem, { id: number; resolved: boolean }>({
      query: ({ id, resolved }) => ({ url: `questions/${id}`, method: 'PATCH', body: { resolved } }),
      invalidatesTags: ['Questions'],
    }),
  }),
});

export const { useListQuestionCardsQuery, useSetQuestionResolvedMutation } = questionsApiEndpoints;
export { questionsApiEndpoints };
