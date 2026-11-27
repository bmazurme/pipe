import { createApi } from "@reduxjs/toolkit/query/react";

import baseQuery from "../../base-query-with-reauth";

const sessionsApi = createApi({
  reducerPath: "sessionsApi",
  baseQuery,
  tagTypes: ["Sessions", "Identities", "TwoFactor"],
  endpoints: () => ({}),
});

export default sessionsApi;
