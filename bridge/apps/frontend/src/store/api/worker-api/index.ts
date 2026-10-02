import { createApi } from '@reduxjs/toolkit/query/react';

import baseQuery from '../../base-query-with-reauth';

const workerApi = createApi({
  reducerPath: 'workerApi',
  baseQuery,
  tagTypes: ['WorkerJob', 'ClaudeCredential'],
  endpoints: () => ({}),
});

export default workerApi;
