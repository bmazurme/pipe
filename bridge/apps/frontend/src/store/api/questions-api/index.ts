import { createApi } from '@reduxjs/toolkit/query/react';

import baseQuery from '../../base-query-with-reauth';

const questionsApi = createApi({
  reducerPath: 'questionsApi',
  baseQuery,
  tagTypes: ['Questions'],
  endpoints: () => ({}),
});

export default questionsApi;
