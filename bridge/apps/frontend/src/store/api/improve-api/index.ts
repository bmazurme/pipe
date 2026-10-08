import { createApi } from '@reduxjs/toolkit/query/react';

import baseQuery from '../../base-query-with-reauth';

const improveApi = createApi({
  reducerPath: 'improveApi',
  baseQuery,
  tagTypes: ['ImproveIssues', 'ImproveRuns', 'ImproveSchedules', 'ImproveSettings'],
  endpoints: () => ({}),
});

export default improveApi;
