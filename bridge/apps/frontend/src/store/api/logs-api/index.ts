import { createApi } from '@reduxjs/toolkit/query/react';

import baseQuery from '../../base-query-with-reauth';

const logsApi = createApi({
  reducerPath: 'logsApi',
  baseQuery,
  tagTypes: ['AppLogs'],
  endpoints: () => ({}),
});

export default logsApi;
