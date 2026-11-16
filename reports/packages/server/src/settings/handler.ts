import type { Request, Response } from 'express';
import type { SettingsBundleType, SettingsType } from '@reports/shared';

import { getSettings, setSettings } from './props';
import { withStream } from '../utils/stream';
import { redactSettings, restoreMaskedSecrets } from './redact';
import { buildSettingsBundle, applySettingsBundle } from './bundle';
import { isConnectionCheckTarget, runConnectionCheck } from './connection-check';

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

// Checks what is in the form, not only what is saved: the body may carry unsaved settings, and a
// masked secret in it stands for the stored one — so a check never needs a Save first.
export async function handleCheckConnection(req: Request, res: Response) {
  await withStream(res, 'Check connection', async () => {
    const { target } = req.params;

    if (!isConnectionCheckTarget(target)) {
      throw new Error(`Неизвестная проверка: ${target}`);
    }

    const stored = getSettings();
    const incoming = (req.body as { settings?: Partial<SettingsType> } | undefined)?.settings;
    const settings = incoming ? restoreMaskedSecrets({ ...stored, ...incoming }, stored) : stored;

    return runConnectionCheck(target, settings);
  });
}
