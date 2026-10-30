import { createApi } from '@reduxjs/toolkit/query/react';

import baseQuery from '../../base-query-with-reauth';

const inboxApi = createApi({
  reducerPath: 'inboxApi',
  baseQuery,
  tagTypes: ['Inbox'],
  endpoints: () => ({}),
});

export default inboxApi;
