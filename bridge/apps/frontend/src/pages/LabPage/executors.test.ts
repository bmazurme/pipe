import { describe, expect, it } from 'vitest';

import { modelAfterExecutor, modelsFor } from './executors';

const options = ['auto', 'sonnet', 'opus', 'haiku', 'gpt', 'custom:9'].map((value) => ({ value }));

describe('Fusion needs a model with a shell', () => {
  it('offers only Claude for Fusion, everything for any worker', () => {
    // 'auto' stays: the router keeps Fusion on Claude by itself
    expect(modelsFor(options, 'fusion').map((option) => option.value)).toEqual(['auto', 'sonnet', 'opus', 'haiku']);
    expect(modelsFor(options, 'any')).toHaveLength(6);
    expect(modelsFor(options, undefined)).toHaveLength(6);
  });

  it('falls back to Sonnet when Fusion is chosen with a model that cannot take it, and leaves a fitting one alone', () => {
    expect(modelAfterExecutor('custom:9', 'fusion')).toBe('sonnet');
    expect(modelAfterExecutor('gpt', 'fusion')).toBe('sonnet');
    expect(modelAfterExecutor('opus', 'fusion')).toBe('opus');
    expect(modelAfterExecutor('auto', 'fusion')).toBe('auto');
    expect(modelAfterExecutor('custom:9', 'any')).toBe('custom:9');
  });
});
