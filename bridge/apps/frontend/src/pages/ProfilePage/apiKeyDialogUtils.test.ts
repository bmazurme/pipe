import { describe, expect, it } from 'vitest';

import { describeNewKey, expiryDate, expiryHint, KEY_PRESETS, usageExample } from './apiKeyDialogUtils';

const NOW = new Date('2026-11-12T10:00:00Z');

describe('apiKeyDialogUtils', () => {
  it('names the day a key with an expiry stops working', () => {
    expect(expiryDate('30', NOW)).toBe('12 декабря 2026 г.');
    expect(expiryDate('365', NOW)).toBe('12 ноября 2027 г.');
    expect(expiryDate('never', NOW)).toBeNull();
  });

  it('explains both kinds of expiry', () => {
    expect(expiryHint('90', NOW)).toBe('Перестанет работать 10 февраля 2027 г. — тогда понадобится новый ключ.');
    expect(expiryHint('never', NOW)).toContain('пока вы его не отзовёте');
  });

  it('sums up what was made', () => {
    expect(describeNewKey('laptop', '30', false, NOW)).toBe('laptop · до 12 декабря 2026 г. · полный доступ');
    expect(describeNewKey('плата', 'never', true, NOW)).toBe('плата · бессрочно · только для плат');
  });

  it('builds the test request with the token', () => {
    expect(usageExample('https://bridge.example', 'brk_x')).toBe('curl -H "X-Api-Key: brk_x" https://bridge.example/api/v1/worker/status');
  });

  it('offers the boards agent as the only boards-only name', () => {
    expect(KEY_PRESETS.filter((preset) => preset.boards).map((preset) => preset.name)).toEqual(['агент плат']);
  });
});
