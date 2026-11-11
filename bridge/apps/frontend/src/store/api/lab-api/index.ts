import { createApi } from '@reduxjs/toolkit/query/react';

import baseQuery from '../../base-query-with-reauth';

const labApi = createApi({
  reducerPath: 'labApi',
  baseQuery,
  tagTypes: ['LabProjects', 'LabSchedules', 'LabRuns', 'RouterSettings', 'LabKnowledge', 'LabDigests', 'LabDigestSettings', 'LabDigestPreview'],
  endpoints: () => ({}),
});

export default labApi;
