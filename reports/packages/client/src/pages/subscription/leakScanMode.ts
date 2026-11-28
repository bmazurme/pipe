import type { LeakScanModeType, SubscriptionConfigType } from '@reports/shared';

/** The mode a config means: its own, else what the older strict switch said, else the default (stop on keys). */
export function leakScanModeOf(config: Pick<SubscriptionConfigType, 'leakScanMode' | 'leakScanStrict'> | undefined): LeakScanModeType {
  if (config?.leakScanMode) return config.leakScanMode;
  if (config?.leakScanStrict === true) return 'all';
  if (config?.leakScanStrict === false) return 'warn';

  return 'credentials';
}
