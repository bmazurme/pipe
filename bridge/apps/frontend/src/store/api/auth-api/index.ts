import { createApi } from "@reduxjs/toolkit/query/react";

import baseQuery from "../../base-query";
import { API_URL } from "../env";

export type OauthProvider = "yandex" | "github";

export function getOauthUrl(provider: OauthProvider, state?: string): string {
  const url = `${API_URL}/api/v1/oauth/${provider}`;

  return state ? `${url}?state=${encodeURIComponent(state)}` : url;
}

export function getYandexLoginUrl(): string {
  return getOauthUrl("yandex");
}

export function getGithubLoginUrl(): string {
  return getOauthUrl("github");
}

const authApi = createApi({
  reducerPath: "authApi",
  baseQuery,
  tagTypes: ["Auth", "EmergencyKey"],
  endpoints: () => ({}),
});

export default authApi;
