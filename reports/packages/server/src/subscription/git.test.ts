import { describe, it, expect } from 'vitest';

import { buildBranchName } from './git';

describe('buildBranchName', () => {
  it('builds the username-date-iid mask', () => {
    const date = new Date('2026-09-15T10:00:00Z');

    expect(buildBranchName('mazur', 123, date)).toBe('mazur-15.09.2026-123');
  });

  it('lower-cases and sanitizes an unsafe username to [a-z0-9-]', () => {
    const date = new Date('2026-01-05T10:00:00Z');

    expect(buildBranchName('Bogdan.Mazur@Ex', 7, date)).toBe('bogdan-mazur-ex-05.01.2026-7');
  });

  it('falls back to "user" when the username sanitizes to nothing', () => {
    const date = new Date('2026-01-05T10:00:00Z');

    expect(buildBranchName('...', 1, date)).toBe('user-05.01.2026-1');
  });
});
