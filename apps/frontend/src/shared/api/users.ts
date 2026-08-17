import { apiFetch } from './http';

export interface Me {
  id: number;
  username: string;
  status: string;
}

export async function fetchMe(): Promise<Me> {
  const response = await apiFetch('/api/v1/users/me');

  if (!response.ok) {
    throw new Error('Failed to fetch current user');
  }

  return response.json();
}

export async function updateUser(
  id: number,
  data: { status: string },
): Promise<{ id: number; email: string; status: string }> {
  const response = await apiFetch(`/api/v1/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error('Failed to update user');
  }

  return response.json();
}
