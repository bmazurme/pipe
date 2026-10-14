import type { SettingsBundleType } from '@reports/shared';

import { getSettings, setSettings } from './props';
import { getSubscriptionConfig, setSubscriptionConfig } from '../subscription/config-props';
import { getProjectDict, setProjectDict } from '../reports/project-dict-props';
import { addOffDays, getAllOffDaysByYear } from '../counts/props';

export const SETTINGS_BUNDLE_VERSION = 1;

// Shared by the file export/import handlers and the bridge push/pull handlers —
// one place that knows what a "bundle" is and how to apply one back.
export function buildSettingsBundle(): SettingsBundleType {
  return {
    version: SETTINGS_BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    settings: getSettings(),
    subscriptionConfig: getSubscriptionConfig(),
    projectDict: getProjectDict(),
    offDaysByYear: getAllOffDaysByYear(),
  };
}

export function applySettingsBundle(bundle: SettingsBundleType): { skippedYears: string[] } {
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

  return { skippedYears };
}
