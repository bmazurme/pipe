import { createApi } from '@reduxjs/toolkit/query/react';

import baseQuery from '../../base-query';
import { API_URL } from '../env';

export function getYandexLoginUrl(): string {
  return `${API_URL}/api/v1/oauth/yandex`;
}

const authApi = createApi({
  reducerPath: 'authApi',
  baseQuery,
  tagTypes: ['Auth'],
  endpoints: () => ({}),
});

export default authApi;
