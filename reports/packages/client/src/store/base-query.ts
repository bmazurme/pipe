import { fetchBaseQuery } from '@reduxjs/toolkit/query';

import { BASE_API_URL } from '../utils/constants';

const baseQuery = fetchBaseQuery({
  baseUrl: BASE_API_URL,
  // credentials: 'include',
});

export default baseQuery;
