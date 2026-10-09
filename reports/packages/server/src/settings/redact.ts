import type { SettingsType } from '@reports/shared';

// The three fields that are credentials, not preferences.
export const SECRET_SETTING_KEYS = ['privateToken', 'bridgeApiKey', 'bridgeStorageApiKey'] as const;

// What the UI is shown (and sends back unchanged) in place of a stored secret.
export const SECRET_MASK = '••••••••';

// GET /api/settings: any page that could reach this server must not read a raw token.
export function redactSettings(settings: SettingsType): SettingsType {
  const redacted = { ...settings };

  for (const key of SECRET_SETTING_KEYS) {
    if (redacted[key]) redacted[key] = SECRET_MASK;
  }

  return redacted;
}

// POST /api/settings: the form holds the mask for a secret the user did not touch, which must
// keep the stored value rather than overwrite it with the mask. An empty string still clears it.
export function restoreMaskedSecrets(incoming: SettingsType, stored: SettingsType): SettingsType {
  const merged = { ...incoming };

  for (const key of SECRET_SETTING_KEYS) {
    if (merged[key] === SECRET_MASK) merged[key] = stored[key];
  }

  return merged;
}
