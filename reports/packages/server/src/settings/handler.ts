import type { Request, Response } from 'express';
import type { SettingsBundleType, SettingsType, StreamEvent } from '@reports/shared';

import { getSettings, setSettings } from './props';
import { redactSettings, restoreMaskedSecrets } from './redact';
import { buildSettingsBundle, applySettingsBundle } from './bundle';
import { getSubscriptionConfig } from '../subscription/config-props';
import { getProjectDict } from '../reports/project-dict-props';

export async function handleGetSettings(req: Request, res: Response) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  const sendEvent = (event: StreamEvent) => {
    res.write(JSON.stringify(event) + '\n');
  };

  try {
    sendEvent({ type: 'message', data: redactSettings(getSettings()) });
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

export async function handleExportSettingsBundle(req: Request, res: Response) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  const sendEvent = (event: StreamEvent) => {
    res.write(JSON.stringify(event) + '\n');
  };

  try {
    sendEvent({ type: 'message', data: buildSettingsBundle() });
    res.end();
  } catch (error) {
    console.error('Export settings bundle error:', error);
    sendEvent({
      type: 'error',
      data: error instanceof Error ? error.message : 'Unknown error',
    });
    res.end();
  }
}

export async function handleImportSettingsBundle(req: Request, res: Response) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  const sendEvent = (event: StreamEvent) => {
    res.write(JSON.stringify(event) + '\n');
  };

  try {
    const bundle = req.body as SettingsBundleType;
    const { skippedYears } = applySettingsBundle(bundle);

    sendEvent({
      type: 'message',
      data: {
        settings: getSettings(),
        subscriptionConfig: getSubscriptionConfig(),
        projectDict: getProjectDict(),
        skippedYears,
      },
    });
    res.end();
  } catch (error) {
    console.error('Import settings bundle error:', error);
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
    const settings = setSettings(restoreMaskedSecrets(req.body as SettingsType, getSettings()));

    // The saved settings go back to the UI masked, like GET: the secret was just stored, not echoed.
    sendEvent({ type: 'message', data: redactSettings(settings) });
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
