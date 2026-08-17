import { apiFetch } from './http';

export interface PurgeEntry {
  id: number;
  key: string;
  value: string;
  createdAt: string;
}

export async function listEntries(): Promise<PurgeEntry[]> {
  const response = await apiFetch('/api/v1/purge');

  if (!response.ok) {
    throw new Error('Failed to fetch dictionary');
  }

  return response.json();
}

async function duplicateFieldError(
  response: Response,
  fallback: string,
): Promise<Error> {
  const body = await response.json().catch(() => null);
  const message: string | undefined = body?.message;

  if (message?.startsWith('Key ')) {
    return new Error('Такой ключ уже есть в словаре');
  }
  if (message?.startsWith('Value ')) {
    return new Error('Такое значение уже есть в словаре');
  }
  return new Error(fallback);
}

export async function createEntry(
  key: string,
  value: string,
): Promise<PurgeEntry> {
  const response = await apiFetch('/api/v1/purge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  });

  if (!response.ok) {
    throw await duplicateFieldError(response, 'Не удалось добавить запись');
  }

  return response.json();
}

export async function updateEntry(
  id: number,
  key: string,
  value: string,
): Promise<PurgeEntry> {
  const response = await apiFetch(`/api/v1/purge/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  });

  if (!response.ok) {
    throw await duplicateFieldError(response, 'Не удалось сохранить изменения');
  }

  return response.json();
}

export async function deleteEntry(id: number): Promise<void> {
  const response = await apiFetch(`/api/v1/purge/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error('Не удалось удалить запись');
  }
}
