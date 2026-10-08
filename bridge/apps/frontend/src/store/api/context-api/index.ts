import { createApi } from '@reduxjs/toolkit/query/react';

import baseQuery from '../../base-query-with-reauth';

const contextApi = createApi({
  reducerPath: 'contextApi',
  baseQuery,
  tagTypes: ['Context'],
  endpoints: () => ({}),
});

export default contextApi;
