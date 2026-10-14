import { createApi } from '@reduxjs/toolkit/query/react';

import baseQuery from '../../base-query-with-reauth';

const reportsReleaseApi = createApi({
  reducerPath: 'reportsReleaseApi',
  baseQuery,
  endpoints: () => ({}),
});

export default reportsReleaseApi;
