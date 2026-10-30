import type { BridgeReportEntry } from '@reports/shared';

import { bridgeErrorMessage, bridgeFetch } from '../utils/bridge-fetch';

export async function pushReportToBridge(year: number, month: number, entries: BridgeReportEntry[]) {
  const response = await bridgeFetch('/api/v1/time/import/reports', { method: 'POST', json: { year, month, entries } });

  if (!response.ok) {
    throw new Error(await bridgeErrorMessage(response));
  }

  return response.json();
}
