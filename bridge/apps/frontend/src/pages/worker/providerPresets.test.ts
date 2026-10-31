import { describe, expect, it } from 'vitest';

import { describeKey, parseHeaderLines, presetById, PROVIDER_PRESETS } from './providerPresets';

describe('parseHeaderLines', () => {
  it('reads "name: value" lines, keeps colons inside a value, skips blank lines', () => {
    expect(parseHeaderLines('x-folder-id: b1g\n\n  X-Url :  http://a:80 \n')).toEqual({
      headers: { 'x-folder-id': 'b1g', 'X-Url': 'http://a:80' },
      invalid: [],
    });
  });

  it('reports lines it cannot use instead of guessing', () => {
    expect(parseHeaderLines('nocolon\n: empty-name\nname:\nbad name: v\nok: 1').invalid).toEqual([
      'nocolon',
      ': empty-name',
      'name:',
      'bad name: v',
    ]);
  });
});

describe('presets', () => {
  it('each one has an id of its own, and Gemini is routed through the VPN while local servers go direct and need no key', () => {
    expect(new Set(PROVIDER_PRESETS.map((preset) => preset.id)).size).toBe(PROVIDER_PRESETS.length);
    expect(presetById('gemini')).toMatchObject({ route: 'vpn', authScheme: 'bearer' });
    expect(presetById('ollama')).toMatchObject({ route: 'direct', authScheme: 'none' });
    expect(presetById('yandex')).toMatchObject({ authScheme: 'api-key', route: 'direct' });
    expect(presetById('nope')).toBeUndefined();
  });
});

describe('describeKey', () => {
  const base = { provider: 'custom', route: 'auto', authScheme: 'bearer', supportsTools: true, timeoutSec: null, allowedWorkerIds: null } as const;

  it('is empty for the named providers and short for a plain custom key', () => {
    expect(describeKey({ ...base, provider: 'gpt' })).toBe('');
    expect(describeKey(base)).toBe('маршрут: авто');
  });

  it('lists what is unusual', () => {
    expect(describeKey({ ...base, route: 'direct', authScheme: 'none', supportsTools: false, timeoutSec: 900, allowedWorkerIds: [5] })).toBe(
      'напрямую · без ключа · без вызова функций (только чат) · таймаут 900 с · только worker: 1',
    );
  });
});
