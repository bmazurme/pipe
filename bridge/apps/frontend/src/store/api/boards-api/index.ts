import { createApi } from '@reduxjs/toolkit/query/react';

import baseQuery from '../../base-query-with-reauth';

const boardsApi = createApi({
  reducerPath: 'boardsApi',
  baseQuery,
  tagTypes: ['Boards'],
  endpoints: () => ({}),
});

export default boardsApi;
