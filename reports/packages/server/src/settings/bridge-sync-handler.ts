import type { Request, Response } from 'express';
import type { SettingsBundleType } from '@reports/shared';

import { getSettings } from './props';
import { buildSettingsBundle, applySettingsBundle } from './bundle';
import { describeFetchError } from '../utils/describe-fetch-error';
import { withStream } from '../utils/stream';

const BRIDGE_TIMEOUT_MS = 20_000;

interface BridgeBackupResponse {
  updatedAt: string;
  payload: string;
}

async function describeBridgeResponseError(response: Awaited<ReturnType<typeof fetch>>): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
  const message = Array.isArray(body?.message) ? body.message.join('; ') : body?.message;

  return `Bridge API вернул ошибку ${response.status}${message ? `: ${message}` : ''}`;
}

export async function handlePushSettingsToBridge(req: Request, res: Response) {
  await withStream(res, 'Push settings to bridge', async () => {
    const { bridgeApiUrl, bridgeApiKey } = getSettings();

    if (!bridgeApiUrl || !bridgeApiKey) {
      throw new Error('Интеграция с bridge не настроена: укажите адрес и ключ на странице Settings');
    }

    const { origin } = new URL(bridgeApiUrl);
    const url = `${origin}/api/v1/reports-settings`;
    const payload = JSON.stringify(buildSettingsBundle());

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'X-Api-Key': bridgeApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ payload }),
      signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
    }).catch((error) => {
      throw describeFetchError(error, url);
    });

    if (!response.ok) {
      throw new Error(await describeBridgeResponseError(response));
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

    const { origin } = new URL(bridgeApiUrl);
    const url = `${origin}/api/v1/reports-settings/payload`;

    const response = await fetch(url, {
      headers: { 'X-Api-Key': bridgeApiKey },
      signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
    }).catch((error) => {
      throw describeFetchError(error, url);
    });

    if (response.status === 404) {
      throw new Error('На bridge ещё нет сохранённых настроек');
    }

    if (!response.ok) {
      throw new Error(await describeBridgeResponseError(response));
    }

    const { payload } = (await response.json()) as BridgeBackupResponse;
    const bundle = JSON.parse(payload) as SettingsBundleType;
    const { skippedYears } = applySettingsBundle(bundle);

    return { skippedYears };
  });
}
