import type { Request, Response } from 'express';
import type { DayOffsImportType, StreamEvent } from '@reports/shared';

import { countWorkAndShortDays } from '../utils/count-work-and-short-days';
import { describeFetchError } from '../utils/describe-fetch-error';
import { getSettings } from '../settings/props';
import { getProps, addOffDays, removeOffDay, importDayOffs } from './props';

export async function handleCounts(req: Request, res: Response) {
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

export async function handleAddOffDay(req: Request, res: Response) {
  const { id } = req.params;
  const { dates } = req.body;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  const sendEvent = (event: StreamEvent) => {
    res.write(JSON.stringify(event) + '\n');
  };

  try {
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

export async function handleRemoveOffDay(req: Request, res: Response) {
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

export async function handleImportDayOffs(req: Request, res: Response) {
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