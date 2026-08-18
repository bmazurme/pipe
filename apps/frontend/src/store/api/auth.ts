import { API_URL } from './env';

export interface CheckAuthResponse {
  isAuthenticated: boolean;
  accessToken?: string;
}

export async function checkAuth(): Promise<CheckAuthResponse> {
  const response = await fetch(`${API_URL}/api/v1/auth/check`, {
    credentials: 'include',
  });

  return response.json();
}

export async function logout(): Promise<void> {
  await fetch(`${API_URL}/api/v1/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  });
}

export function getYandexLoginUrl(): string {
  return `${API_URL}/api/v1/oauth/yandex`;
}
