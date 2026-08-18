import timeApi from '..';

export interface DayOff {
  id: number;
  date: string;
}

function duplicateDateMessage(data: unknown): string | undefined {
  const message = (data as { message?: string } | undefined)?.message;

  return message?.includes('already exists') ? 'Этот день уже отмечен' : undefined;
}

const timeApiEndpoints = timeApi.injectEndpoints({
  endpoints: (builder) => ({
    listDayOffs: builder.query<DayOff[], number>({
      query: (year) => `time/day-offs?year=${year}`,
      providesTags: ['DayOffs'],
    }),
    createDayOff: builder.mutation<DayOff, string>({
      query: (date) => ({ url: 'time/day-offs', method: 'POST', body: { date } }),
      invalidatesTags: ['DayOffs'],
      transformErrorResponse: (response) =>
        duplicateDateMessage(response.data) ?? 'Не удалось добавить день',
    }),
    deleteDayOff: builder.mutation<void, number>({
      query: (id) => ({ url: `time/day-offs/${id}`, method: 'DELETE' }),
      invalidatesTags: ['DayOffs'],
      transformErrorResponse: () => 'Не удалось удалить день',
    }),
  }),
});

export const {
  useListDayOffsQuery,
  useCreateDayOffMutation,
  useDeleteDayOffMutation,
} = timeApiEndpoints;
export { timeApiEndpoints };
