import { createApi } from '@reduxjs/toolkit/query/react';

import baseQuery from '../../base-query-with-reauth';

const dashboardApi = createApi({
  reducerPath: 'dashboardApi',
  baseQuery,
  endpoints: () => ({}),
});

export default dashboardApi;
