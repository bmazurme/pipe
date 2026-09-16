import { API_URL } from '../../store/api/env';
import { MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_MB, StoredFileMeta } from '../../store/api';

// fetchBaseQuery (plain fetch) exposes no upload-progress event, so every
// upload goes around RTK Query and talks to the same POST /storage endpoint
// directly via XHR. Callers invalidate the Storage tag themselves once done.
export function uploadWithProgress(
  blob: Blob,
  filename: string,
  accessToken: string | null,
  onProgress: (fraction: number) => void,
): Promise<StoredFileMeta> {
  return new Promise((resolve, reject) => {
    // Checked before the request so a file that can't possibly land doesn't
    // spend minutes uploading only to be rejected at the end.
    if (blob.size > MAX_FILE_SIZE_BYTES) {
      reject(new Error(`«${filename}» превышает лимит ${MAX_FILE_SIZE_MB} МБ`));
      return;
    }

    const formData = new FormData();
    formData.append('file', blob, filename);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/api/v1/storage`);
    xhr.withCredentials = true;
    if (accessToken) {
      xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as StoredFileMeta);
        } catch {
          reject(new Error('Некорректный ответ сервера'));
        }
        return;
      }

      if (xhr.status === 413) {
        reject(new Error(`«${filename}» превышает лимит ${MAX_FILE_SIZE_MB} МБ`));
        return;
      }

      reject(new Error(`Не удалось загрузить «${filename}»`));
    };

    xhr.onerror = () => reject(new Error(`Не удалось загрузить «${filename}»`));

    xhr.send(formData);
  });
}
