import { createApi } from '@reduxjs/toolkit/query/react';

import baseQuery from '../../base-query-with-reauth';

const apiKeysApi = createApi({
  reducerPath: 'apiKeysApi',
  baseQuery,
  tagTypes: ['ApiKeys'],
  endpoints: () => ({}),
});

export default apiKeysApi;
