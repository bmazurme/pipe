import { API_URL } from '../../store/api/env';
import { MAX_FILE_SIZE_MB, StoredFileMeta } from '../../store/api';

// fetchBaseQuery (plain fetch) has no upload-progress event, so the one
// upload that needs a live progress bar goes around RTK Query and talks to
// the same POST /storage endpoint directly via XHR.
export function uploadZipWithProgress(
  blob: Blob,
  filename: string,
  accessToken: string | null,
  onProgress: (fraction: number) => void,
): Promise<StoredFileMeta> {
  return new Promise((resolve, reject) => {
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
        reject(new Error(`Архив превышает лимит ${MAX_FILE_SIZE_MB} МБ`));
        return;
      }

      reject(new Error('Не удалось загрузить архив'));
    };

    xhr.onerror = () => reject(new Error('Не удалось загрузить архив'));

    xhr.send(formData);
  });
}
