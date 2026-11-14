import { createApi } from '@reduxjs/toolkit/query/react';

import baseQuery from '../../base-query-with-reauth';

const promoApi = createApi({
  reducerPath: 'promoApi',
  baseQuery,
  tagTypes: ['PromoPosts', 'PromoAssets', 'PromoLanding', 'PromoOverview'],
  endpoints: () => ({}),
});

export default promoApi;
