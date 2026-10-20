import type { Request, Response } from 'express';
import type { DayOffsImportType, DayOffsSendResultType, StreamEvent } from '@reports/shared';

import { countWorkAndShortDays } from '../utils/count-work-and-short-days';
import { describeFetchError } from '../utils/describe-fetch-error';
import { isDateStringArray } from '../utils/is-date-string-array';
import { getSettings } from '../settings/props';
import { getProps, addOffDays, removeOffDay, importDayOffs } from './props';

const BRIDGE_TIMEOUT_MS = 20_000;

export { isDateStringArray };

export async function handleCounts(req: Request<Record<string, string>>, res: Response) {
  const { id } = req.params;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  const sendEvent = (event: StreamEvent) => {
    res.write(JSON.stringify(event) + '\n');
  };

  try {
    const { holidays, shortDays, badDays, offDays } = getProps(id);
    const calendar = countWorkAndShortDays(Number(id), holidays, shortDays, badDays, offDays);

    sendEvent({ type: 'message', data: { calendar, holidays, shortDays, badDays, offDays } });
    res.end();
  } catch (error) {
    console.error('Counts error:', error);
    sendEvent({
      type: 'error',
      data: error instanceof Error ? error.message : 'Unknown error',
    });
    res.end();
  }
}

export async function handleAddOffDay(req: Request<Record<string, string>>, res: Response) {
  const { id } = req.params;
  const { dates } = req.body;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  const sendEvent = (event: StreamEvent) => {
    res.write(JSON.stringify(event) + '\n');
  };

  try {
    if (!isDateStringArray(dates)) {
      throw new Error('Поле dates должно быть массивом строк формата YYYY-MM-DD');
    }

    const { holidays, shortDays, badDays, offDays } = addOffDays(id, dates);
    const calendar = countWorkAndShortDays(Number(id), holidays, shortDays, badDays, offDays);

    sendEvent({ type: 'message', data: { calendar, holidays, shortDays, badDays, offDays } });
    res.end();
  } catch (error) {
    console.error('Add off day error:', error);
    sendEvent({
      type: 'error',
      data: error instanceof Error ? error.message : 'Unknown error',
    });
    res.end();
  }
}

export async function handleRemoveOffDay(req: Request<Record<string, string>>, res: Response) {
  const { id, date } = req.params;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  const sendEvent = (event: StreamEvent) => {
    res.write(JSON.stringify(event) + '\n');
  };

  try {
    const { holidays, shortDays, badDays, offDays } = removeOffDay(id, date);
    const calendar = countWorkAndShortDays(Number(id), holidays, shortDays, badDays, offDays);

    sendEvent({ type: 'message', data: { calendar, holidays, shortDays, badDays, offDays } });
    res.end();
  } catch (error) {
    console.error('Remove off day error:', error);
    sendEvent({
      type: 'error',
      data: error instanceof Error ? error.message : 'Unknown error',
    });
    res.end();
  }
}

export async function handleImportDayOffs(req: Request<Record<string, string>>, res: Response) {
  const { id } = req.params;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  const sendEvent = (event: StreamEvent) => {
    res.write(JSON.stringify(event) + '\n');
  };

  try {
    const { bridgeApiUrl, bridgeApiKey } = getSettings();

    if (!bridgeApiUrl || !bridgeApiKey) {
      throw new Error('Интеграция с bridge не настроена: укажите адрес и ключ на странице Settings');
    }

    const url = new URL(bridgeApiUrl);
    url.searchParams.set('year', id);

    const bridgeResponse = await fetch(url, {
      headers: { 'X-Api-Key': bridgeApiKey },
      signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
    }).catch((error) => {
      throw describeFetchError(error, url);
    });

    if (!bridgeResponse.ok) {
      throw new Error(`Bridge API вернул ошибку ${bridgeResponse.status}`);
    }

    const imported = await bridgeResponse.json() as DayOffsImportType;
    const { holidays, shortDays, badDays, offDays } = importDayOffs(id, imported);
    const calendar = countWorkAndShortDays(Number(id), holidays, shortDays, badDays, offDays);

    sendEvent({ type: 'message', data: { calendar, holidays, shortDays, badDays, offDays } });
    res.end();
  } catch (error) {
    console.error('Import day offs error:', error);
    sendEvent({
      type: 'error',
      data: error instanceof Error ? error.message : 'Unknown error',
    });
    res.end();
  }
}

// Settings keep the address of bridge's EXPORT route (…/api/v1/time/export/day-offs), which "Получить" reads; the
// route that takes the dates in the other direction sits next to it.
export function bridgeSendUrl(exportUrl: string): URL {
  const url = new URL(exportUrl);

  if (!/\/export\/day-offs\/?$/.test(url.pathname)) {
    throw new Error('Адрес Bridge API в Settings должен оканчиваться на /time/export/day-offs — по нему же определяется адрес отправки');
  }
  url.pathname = url.pathname.replace(/\/export\/day-offs\/?$/, '/import/day-offs');
  url.search = '';

  return url;
}

// "Отправить": the year's dates reports holds go to bridge, which merges them into the account's own (nothing is deleted there).
export async function sendDayOffsToBridge(year: string): Promise<DayOffsSendResultType> {
  const { bridgeApiUrl, bridgeApiKey } = getSettings();

  if (!bridgeApiUrl || !bridgeApiKey) {
    throw new Error('Интеграция с bridge не настроена: укажите адрес и ключ на странице Settings');
  }

  const url = bridgeSendUrl(bridgeApiUrl);
  const { holidays, shortDays, badDays, offDays } = getProps(year);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'X-Api-Key': bridgeApiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ year: Number(year), holidays, shortDays, badDays, offDays }),
    signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
  }).catch((error) => {
    throw describeFetchError(error, url);
  });

  if (!response.ok) {
    const detail = await response.json().then((body) => (body as { message?: string | string[] }).message).catch(() => undefined);

    throw new Error(`Bridge API вернул ошибку ${response.status}${detail ? `: ${Array.isArray(detail) ? detail.join('; ') : detail}` : ''}`);
  }

  return (await response.json()) as DayOffsSendResultType;
}

export async function handleSendDayOffs(req: Request<Record<string, string>>, res: Response) {
  const { id } = req.params;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  const sendEvent = (event: StreamEvent) => {
    res.write(JSON.stringify(event) + '\n');
  };

  try {
    sendEvent({ type: 'message', data: await sendDayOffsToBridge(id) });
    res.end();
  } catch (error) {
    console.error('Send day offs error:', error);
    sendEvent({
      type: 'error',
      data: error instanceof Error ? error.message : 'Unknown error',
    });
    res.end();
  }
}
