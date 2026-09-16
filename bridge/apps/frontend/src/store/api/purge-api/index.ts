import { createApi } from '@reduxjs/toolkit/query/react';

import baseQuery from '../../base-query-with-reauth';

const purgeApi = createApi({
  reducerPath: 'purgeApi',
  baseQuery,
  tagTypes: ['Purge'],
  endpoints: () => ({}),
});

export default purgeApi;
