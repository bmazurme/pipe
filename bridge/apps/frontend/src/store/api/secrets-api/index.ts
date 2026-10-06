import { createApi } from '@reduxjs/toolkit/query/react';

import baseQuery from '../../base-query-with-reauth';

const secretsApi = createApi({
  reducerPath: 'secretsApi',
  baseQuery,
  tagTypes: ['Secret'],
  endpoints: () => ({}),
});

export default secretsApi;
