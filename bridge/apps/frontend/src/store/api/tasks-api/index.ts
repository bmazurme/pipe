import { createApi } from '@reduxjs/toolkit/query/react';

import baseQuery from '../../base-query-with-reauth';

const tasksApi = createApi({
  reducerPath: 'tasksApi',
  baseQuery,
  tagTypes: ['TaskBoard', 'TaskArchive'],
  endpoints: () => ({}),
});

export default tasksApi;
