import { apiFetch } from './http';

export interface Session {
  id: number;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  isCurrent: boolean;
}

export async function listSessions(): Promise<Session[]> {
  const response = await apiFetch('/api/v1/auth/sessions');

  if (!response.ok) {
    throw new Error('Failed to fetch sessions');
  }

  return response.json();
}

export async function revokeSession(id: number): Promise<void> {
  const response = await apiFetch(`/api/v1/auth/sessions/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error('Failed to revoke session');
  }
}
