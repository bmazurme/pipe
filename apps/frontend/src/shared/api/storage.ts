import { apiFetch } from './http';

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export interface StoredFileMeta {
  id: number;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export async function listFiles(): Promise<StoredFileMeta[]> {
  const response = await apiFetch('/api/v1/storage');

  if (!response.ok) {
    throw new Error('Failed to fetch files');
  }

  return response.json();
}

export async function uploadFile(file: File): Promise<StoredFileMeta> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await apiFetch('/api/v1/storage', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(
      response.status === 413
        ? 'File exceeds the 10 MB limit'
        : 'Failed to upload file',
    );
  }

  return response.json();
}

export async function downloadFile(file: StoredFileMeta): Promise<void> {
  const response = await apiFetch(`/api/v1/storage/${file.id}/download`);

  if (!response.ok) {
    throw new Error('Failed to download file');
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = file.originalName;
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}
