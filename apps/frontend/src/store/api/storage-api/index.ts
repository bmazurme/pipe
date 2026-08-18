import { createApi } from '@reduxjs/toolkit/query/react';

import baseQuery from '../../base-query-with-reauth';

const storageApi = createApi({
  reducerPath: 'storageApi',
  baseQuery,
  tagTypes: ['Storage'],
  endpoints: () => ({}),
});

export default storageApi;
