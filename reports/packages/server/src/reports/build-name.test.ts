import { describe, it, expect, vi, afterEach } from 'vitest';
import { format } from 'date-fns';

import { buildName } from './build-name';

describe('buildName', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds a filename using the current month and year', () => {
    const now = new Date('2025-03-15T12:00:00Z');
    vi.setSystemTime(now);

    expect(buildName()).toBe(`output_${format(now, 'MM')}.${format(now, 'yyyy')}.csv`);
    expect(buildName()).toBe('output_03.2025.csv');
  });
});
