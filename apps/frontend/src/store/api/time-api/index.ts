import { createApi } from '@reduxjs/toolkit/query/react';

import baseQuery from '../../base-query-with-reauth';

const timeApi = createApi({
  reducerPath: 'timeApi',
  baseQuery,
  tagTypes: ['DayOffs'],
  endpoints: () => ({}),
});

export default timeApi;
