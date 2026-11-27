import { fetchBaseQuery } from '@reduxjs/toolkit/query';

import { API_URL } from './api/env';
import type { RootState } from './index';
import { currentStepUpGrant } from './step-up';

const baseQuery = fetchBaseQuery({
  baseUrl: `${API_URL}/api/v1`,
  credentials: 'include',
  prepareHeaders: (headers, { getState }) => {
    const { accessToken } = (getState() as RootState).auth;
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

    const grant = currentStepUpGrant();

    if (grant) headers.set('X-Step-Up', grant);

    return headers;
  },
});

export default baseQuery;
