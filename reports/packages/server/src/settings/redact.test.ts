import { describe, it, expect } from 'vitest';
import type { SettingsType } from '@reports/shared';

import { redactSettings, restoreMaskedSecrets, SECRET_MASK } from './redact';

const settings = (over: Partial<SettingsType> = {}) =>
  ({
    gitlabUrl: 'https://gitlab.com/api/v4',
    privateToken: 'glpat-real',
    bridgeApiKey: 'key-1',
    bridgeStorageApiKey: 'key-2',
    ...over,
  }) as SettingsType;

describe('redactSettings', () => {
  it('never returns a raw token or key', () => {
    const redacted = redactSettings(settings());
    const text = JSON.stringify(redacted);

    expect(text).not.toContain('glpat-real');
    expect(text).not.toContain('key-1');
    expect(text).not.toContain('key-2');
    expect(redacted.privateToken).toBe(SECRET_MASK);
  });

  it('leaves non-secret fields alone and does not invent a mask for an empty secret', () => {
    const redacted = redactSettings(settings({ bridgeApiKey: '' }));

    expect(redacted.gitlabUrl).toBe('https://gitlab.com/api/v4');
    expect(redacted.bridgeApiKey).toBe('');
  });
});

describe('restoreMaskedSecrets', () => {
  it('keeps the stored secret when the form sends the mask back unchanged', () => {
    const merged = restoreMaskedSecrets(settings({ privateToken: SECRET_MASK, bridgeApiKey: SECRET_MASK, bridgeStorageApiKey: SECRET_MASK }), settings());

    expect(merged.privateToken).toBe('glpat-real');
    expect(merged.bridgeApiKey).toBe('key-1');
    expect(merged.bridgeStorageApiKey).toBe('key-2');
  });

  it('takes a secret the user actually typed, and lets an empty one clear it', () => {
    const merged = restoreMaskedSecrets(settings({ privateToken: 'glpat-new', bridgeApiKey: '' }), settings());

    expect(merged.privateToken).toBe('glpat-new');
    expect(merged.bridgeApiKey).toBe('');
  });

  it('never stores the mask itself, even when there is nothing stored to restore', () => {
    const merged = restoreMaskedSecrets(settings({ privateToken: SECRET_MASK }), settings({ privateToken: '' }));

    expect(merged.privateToken).toBe('');
  });
});
