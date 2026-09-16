import type { BridgeReportEntry } from '@reports/shared';

import { describeFetchError } from '../utils/describe-fetch-error';
import { getSettings } from '../settings/props';

export async function pushReportToBridge(year: number, month: number, entries: BridgeReportEntry[]) {
  const { bridgeApiUrl, bridgeApiKey } = getSettings();

  if (!bridgeApiUrl || !bridgeApiKey) {
    throw new Error('Интеграция с bridge не настроена: укажите адрес и ключ на странице Settings');
  }

  const { origin } = new URL(bridgeApiUrl);
  const url = `${origin}/api/v1/time/import/reports`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Api-Key': bridgeApiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ year, month, entries }),
  }).catch((error) => {
    throw describeFetchError(error, url);
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = Array.isArray(body?.message) ? body.message.join('; ') : body?.message;

    throw new Error(`Bridge API вернул ошибку ${response.status}${message ? `: ${message}` : ''}`);
  }

  return response.json();
}
