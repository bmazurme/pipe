import { createApi } from '@reduxjs/toolkit/query/react';

import baseQuery from '../../base-query-with-reauth';

const vpnApi = createApi({
  reducerPath: 'vpnApi',
  baseQuery,
  tagTypes: ['VpnStatus', 'ClaudeUsage'],
  endpoints: () => ({}),
});

export default vpnApi;
