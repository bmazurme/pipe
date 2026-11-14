import { API_URL } from '../../store/api';

/** An <img>/<a> cannot send the bearer token, so a file is fetched and opened from a blob URL. */
export async function fetchAssetBlobUrl(id: number, accessToken: string | null): Promise<string> {
  const response = await fetch(`${API_URL}/api/v1/promo/assets/${id}/content`, {
    credentials: 'include',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });

  if (!response.ok) throw new Error('Не удалось загрузить файл');

  return URL.createObjectURL(await response.blob());
}
