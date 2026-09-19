import type { Request, Response } from 'express';
import type { SettingsBundleType, SettingsType, StreamEvent } from '@reports/shared';

import { getSettings, setSettings } from './props';
import { getSubscriptionConfig, setSubscriptionConfig } from '../subscription/config-props';
import { getProjectDict, setProjectDict } from '../reports/project-dict-props';
import { addOffDays, getAllOffDaysByYear } from '../counts/props';

const SETTINGS_BUNDLE_VERSION = 1;

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

export async function handleExportSettingsBundle(req: Request, res: Response) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  const sendEvent = (event: StreamEvent) => {
    res.write(JSON.stringify(event) + '\n');
  };

  try {
    const bundle: SettingsBundleType = {
      version: SETTINGS_BUNDLE_VERSION,
      exportedAt: new Date().toISOString(),
      settings: getSettings(),
      subscriptionConfig: getSubscriptionConfig(),
      projectDict: getProjectDict(),
      offDaysByYear: getAllOffDaysByYear(),
    };

    sendEvent({ type: 'message', data: bundle });
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

    if (!bundle || typeof bundle !== 'object' || !bundle.settings || !bundle.subscriptionConfig) {
      throw new Error('Файл не похож на экспорт настроек reports');
    }

    setSettings(bundle.settings);
    setSubscriptionConfig(bundle.subscriptionConfig);
    setProjectDict(bundle.projectDict ?? {});

    // Years the bundle carries off-days for but this machine doesn't have a
    // calendar entry for yet (a fresh checkout of a future year, say) are
    // skipped with a warning rather than failing the whole import.
    const skippedYears: string[] = [];
    const existingYears = new Set(Object.keys(getAllOffDaysByYear()));

    for (const [year, offDays] of Object.entries(bundle.offDaysByYear ?? {})) {
      if (!existingYears.has(year)) {
        skippedYears.push(year);
        continue;
      }
      if (offDays.length > 0) {
        addOffDays(year, offDays);
      }
    }

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
