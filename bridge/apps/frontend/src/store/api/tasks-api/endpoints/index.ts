import tasksApi from '..';

export interface TaskCard {
  id: number;
  columnId: number;
  title: string;
  description: string;
  position: number;
  archivedAt: string | null;
}

export interface TaskColumn {
  id: number;
  title: string;
  position: number;
  cards: TaskCard[];
}

export interface TaskBoard {
  columns: TaskColumn[];
}

const tasksApiEndpoints = tasksApi.injectEndpoints({
  endpoints: (builder) => ({
    getTaskBoard: builder.query<TaskBoard, void>({
      query: () => 'tasks/board',
      providesTags: ['TaskBoard'],
    }),
    listArchivedTasks: builder.query<TaskCard[], void>({
      query: () => 'tasks/archive',
      providesTags: ['TaskArchive'],
    }),
    createTaskColumn: builder.mutation<TaskColumn, { title: string }>({
      query: (body) => ({ url: 'tasks/columns', method: 'POST', body }),
      invalidatesTags: ['TaskBoard'],
      transformErrorResponse: () => 'Не удалось добавить колонку',
    }),
    renameTaskColumn: builder.mutation<unknown, { id: number; title: string }>({
      query: ({ id, ...body }) => ({ url: `tasks/columns/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['TaskBoard'],
      transformErrorResponse: () => 'Не удалось переименовать колонку',
    }),
    deleteTaskColumn: builder.mutation<void, number>({
      query: (id) => ({ url: `tasks/columns/${id}`, method: 'DELETE' }),
      invalidatesTags: ['TaskBoard'],
      transformErrorResponse: () => 'Не удалось удалить колонку: сначала уберите из неё карточки',
    }),
    createTaskCard: builder.mutation<TaskCard, { columnId: number; title: string; description?: string }>({
      query: (body) => ({ url: 'tasks/cards', method: 'POST', body }),
      invalidatesTags: ['TaskBoard'],
      transformErrorResponse: () => 'Не удалось добавить карточку',
    }),
    updateTaskCard: builder.mutation<
      TaskCard,
      { id: number; title?: string; description?: string; archived?: boolean }
    >({
      query: ({ id, ...body }) => ({ url: `tasks/cards/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['TaskBoard', 'TaskArchive'],
      transformErrorResponse: () => 'Не удалось сохранить карточку',
    }),
    deleteTaskCard: builder.mutation<void, number>({
      query: (id) => ({ url: `tasks/cards/${id}`, method: 'DELETE' }),
      invalidatesTags: ['TaskBoard', 'TaskArchive'],
      transformErrorResponse: () => 'Не удалось удалить карточку',
    }),
    moveTaskCard: builder.mutation<TaskBoard, { id: number; columnId: number; position: number }>({
      query: ({ id, ...body }) => ({ url: `tasks/cards/${id}/move`, method: 'POST', body }),
      invalidatesTags: ['TaskBoard'],
      transformErrorResponse: () => 'Не удалось переместить карточку',
    }),
  }),
});

export const {
  useGetTaskBoardQuery,
  useListArchivedTasksQuery,
  useCreateTaskColumnMutation,
  useRenameTaskColumnMutation,
  useDeleteTaskColumnMutation,
  useCreateTaskCardMutation,
  useUpdateTaskCardMutation,
  useDeleteTaskCardMutation,
  useMoveTaskCardMutation,
} = tasksApiEndpoints;
export { tasksApiEndpoints };
