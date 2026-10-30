import { createApi } from '@reduxjs/toolkit/query/react';

import baseQuery from '../../base-query-with-reauth';

const usageApi = createApi({
  reducerPath: 'usageApi',
  baseQuery,
  tagTypes: ['Usage'],
  endpoints: () => ({}),
});

export default usageApi;
