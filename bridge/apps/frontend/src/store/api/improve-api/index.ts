import { createApi } from '@reduxjs/toolkit/query/react';

import baseQuery from '../../base-query-with-reauth';

const improveApi = createApi({
  reducerPath: 'improveApi',
  baseQuery,
  tagTypes: ['ImproveIssues', 'ImproveRuns', 'ImproveSchedules', 'ImproveSettings', 'LoopControl'],
  endpoints: () => ({}),
});

export default improveApi;
