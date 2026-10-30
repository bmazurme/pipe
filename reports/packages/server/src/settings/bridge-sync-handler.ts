import type { Request, Response } from 'express';
import type { SettingsBundleType } from '@reports/shared';

import { getSettings } from './props';
import { buildSettingsBundle, applySettingsBundle } from './bundle';
import { bridgeErrorMessage, bridgeFetch } from '../utils/bridge-fetch';
import { withStream } from '../utils/stream';

interface BridgeBackupResponse {
  updatedAt: string;
  payload: string;
}

export async function handlePushSettingsToBridge(req: Request, res: Response) {
  await withStream(res, 'Push settings to bridge', async () => {
    const { bridgeApiUrl, bridgeApiKey } = getSettings();

    if (!bridgeApiUrl || !bridgeApiKey) {
      throw new Error('Интеграция с bridge не настроена: укажите адрес и ключ на странице Settings');
    }

    const payload = JSON.stringify(buildSettingsBundle());

    const response = await bridgeFetch('/api/v1/reports-settings', {
      method: 'PUT',
      apiKey: bridgeApiKey,
      bridgeUrl: bridgeApiUrl,
      json: { payload },
    });

    if (!response.ok) {
      throw new Error(await bridgeErrorMessage(response));
    }

    const data = (await response.json()) as { updatedAt: string };

    return data;
  });
}

export async function handlePullSettingsFromBridge(req: Request, res: Response) {
  await withStream(res, 'Pull settings from bridge', async () => {
    const body = req.body as { bridgeApiUrl?: string; bridgeApiKey?: string };
    const stored = getSettings();
    const bridgeApiUrl = body?.bridgeApiUrl || stored.bridgeApiUrl;
    const bridgeApiKey = body?.bridgeApiKey || stored.bridgeApiKey;

    if (!bridgeApiUrl || !bridgeApiKey) {
      throw new Error('Укажите адрес и API-ключ bridge');
    }

    const response = await bridgeFetch('/api/v1/reports-settings/payload', { apiKey: bridgeApiKey, bridgeUrl: bridgeApiUrl });

    if (response.status === 404) {
      throw new Error('На bridge ещё нет сохранённых настроек');
    }

    if (!response.ok) {
      throw new Error(await bridgeErrorMessage(response));
    }

    const { payload } = (await response.json()) as BridgeBackupResponse;
    const bundle = JSON.parse(payload) as SettingsBundleType;
    const { skippedYears } = applySettingsBundle(bundle);

    return { skippedYears };
  });
}
