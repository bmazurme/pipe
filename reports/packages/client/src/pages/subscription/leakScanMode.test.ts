import { describe, expect, it } from 'vitest';

import { leakScanModeOf } from './leakScanMode';

describe('leakScanModeOf', () => {
  it('is the mode that was set, whatever the older switch says', () => {
    expect(leakScanModeOf({ leakScanMode: 'warn', leakScanStrict: true })).toBe('warn');
  });

  it('reads a config saved before the mode existed', () => {
    expect(leakScanModeOf({ leakScanStrict: true })).toBe('all');
    expect(leakScanModeOf({ leakScanStrict: false })).toBe('warn');
  });

  it('stops on keys when nothing was ever set, or the config is not loaded yet', () => {
    expect(leakScanModeOf({})).toBe('credentials');
    expect(leakScanModeOf(undefined)).toBe('credentials');
  });
});
