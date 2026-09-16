import type { Request, Response } from 'express';
import type { SettingsType, StreamEvent } from '@reports/shared';

import { getSettings, setSettings } from './props';

export async function handleGetSettings(req: Request, res: Response) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  const sendEvent = (event: StreamEvent) => {
    res.write(JSON.stringify(event) + '\n');
  };

  try {
    sendEvent({ type: 'message', data: getSettings() });
    res.end();
  } catch (error) {
    console.error('Get settings error:', error);
    sendEvent({
      type: 'error',
      data: error instanceof Error ? error.message : 'Unknown error',
    });
    res.end();
  }
}

export async function handleSetSettings(req: Request, res: Response) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  const sendEvent = (event: StreamEvent) => {
    res.write(JSON.stringify(event) + '\n');
  };

  try {
    const settings = setSettings(req.body as SettingsType);

    sendEvent({ type: 'message', data: settings });
    res.end();
  } catch (error) {
    console.error('Set settings error:', error);
    sendEvent({
      type: 'error',
      data: error instanceof Error ? error.message : 'Unknown error',
    });
    res.end();
  }
}
