import { createApi } from '@reduxjs/toolkit/query/react';

import baseQuery from '../../base-query-with-reauth';

const reportsSettingsApi = createApi({
  reducerPath: 'reportsSettingsApi',
  baseQuery,
  tagTypes: ['ReportsSettingsBackup'],
  endpoints: () => ({}),
});

export default reportsSettingsApi;
