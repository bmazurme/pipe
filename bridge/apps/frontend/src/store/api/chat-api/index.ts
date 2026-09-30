import { createApi } from '@reduxjs/toolkit/query/react';

import baseQuery from '../../base-query-with-reauth';

const chatApi = createApi({
  reducerPath: 'chatApi',
  baseQuery,
  tagTypes: ['Chat', 'ChatMessages'],
  endpoints: () => ({}),
});

export default chatApi;
