import { fetchBaseQuery } from '@reduxjs/toolkit/query';

import { API_URL } from './api/env';
import type { RootState } from './index';

const baseQuery = fetchBaseQuery({
  baseUrl: `${API_URL}/api/v1`,
  credentials: 'include',
  prepareHeaders: (headers, { getState }) => {
    const { accessToken } = (getState() as RootState).auth;
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
    return headers;
  },
});

export default baseQuery;
