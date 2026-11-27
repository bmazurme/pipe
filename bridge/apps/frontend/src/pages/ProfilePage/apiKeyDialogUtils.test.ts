import { describe, expect, it } from 'vitest';

import { DEFAULT_EXPIRY, describeNewKey, describeScope, expiryDate, expiryHint, idleDays, KEY_PRESETS, scopeOf, usageExample } from './apiKeyDialogUtils';

const NOW = new Date('2026-11-12T10:00:00Z');

describe('apiKeyDialogUtils', () => {
  it('names the day a key with an expiry stops working', () => {
    expect(expiryDate('30', NOW)).toBe('12 декабря 2026 г.');
    expect(expiryDate('365', NOW)).toBe('12 ноября 2027 г.');
    expect(expiryDate('never', NOW)).toBeNull();
  });

  it('suggests 90 days, not «never»', () => {
    expect(DEFAULT_EXPIRY).toBe('90');
  });

  it('explains both kinds of expiry, and calls «never» a choice', () => {
    expect(expiryHint('90', NOW)).toContain('Перестанет работать 10 февраля 2027 г.');
    expect(expiryHint('90', NOW)).toContain('Перевыпустить');
    expect(expiryHint('never', NOW)).toContain('осознанный выбор');
  });

  it('sums up what was made', () => {
    expect(describeNewKey('laptop', '30', undefined, NOW)).toBe('laptop · до 12 декабря 2026 г. · полный доступ');
    expect(describeNewKey('плата', 'never', 'boards', NOW)).toBe('плата · бессрочно · только для плат');
    expect(describeNewKey('ci', '90', 'readonly', NOW)).toContain('только чтение');
  });

  it('turns the dialog\'s choice into the scope the server takes', () => {
    expect(scopeOf('full')).toBeUndefined();
    expect(scopeOf('readonly')).toBe('readonly');
    expect(scopeOf('reports-sync')).toBe('reports-sync');
    expect(describeScope(null)).toBe('полный доступ');
    expect(describeScope('reports-sync')).toBe('для reports (sync)');
  });

  it('builds the test request with the token', () => {
    expect(usageExample('https://bridge.example', 'brk_x')).toBe('curl -H "X-Api-Key: brk_x" https://bridge.example/api/v1/worker/status');
  });

  it('gives the integrations that have a narrower scope that scope', () => {
    expect(Object.fromEntries(KEY_PRESETS.filter((preset) => preset.scope).map((preset) => [preset.name, preset.scope]))).toEqual({
      reports: 'reports-sync',
      'агент плат': 'boards',
    });
  });

  it('counts the days a key sat unused, from its creation when it never was used', () => {
    expect(idleDays('2026-10-12T10:00:00Z', '2026-01-01T00:00:00Z', NOW)).toBe(31);
    expect(idleDays(null, '2026-11-02T10:00:00Z', NOW)).toBe(10);
  });
});
