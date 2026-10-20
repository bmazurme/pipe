import type { Request, Response } from 'express';
import type { SettingsBundleType, SettingsType } from '@reports/shared';

import { getSettings, setSettings } from './props';
import { withStream } from '../utils/stream';
import { redactSettings, restoreMaskedSecrets } from './redact';
import { buildSettingsBundle, applySettingsBundle } from './bundle';

export async function handleGetSettings(req: Request, res: Response) {
  await withStream(res, 'Get settings', async () => {
    return redactSettings(getSettings());
  });
}

export async function handleExportSettingsBundle(req: Request, res: Response) {
  await withStream(res, 'Export settings bundle', async () => {
    return buildSettingsBundle();
  });
}

export async function handleImportSettingsBundle(req: Request, res: Response) {
  await withStream(res, 'Import settings bundle', async () => {
    const bundle = req.body as SettingsBundleType;
    const { skippedYears } = applySettingsBundle(bundle);

    return { skippedYears };
  });
}

export async function handleSetSettings(req: Request, res: Response) {
  await withStream(res, 'Set settings', async () => {
    const settings = setSettings(restoreMaskedSecrets(req.body as SettingsType, getSettings()));

    // The saved settings go back to the UI masked, like GET: the secret was just stored, not echoed.
    return redactSettings(settings);
  });
}
