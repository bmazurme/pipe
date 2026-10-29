import { BadRequestException } from '@nestjs/common';

import { parseUpdatedAfter } from './parse-updated-after';

describe('parseUpdatedAfter', () => {
  it('returns undefined when absent', () => {
    expect(parseUpdatedAfter(undefined)).toBeUndefined();
  });

  it('parses a valid ISO date', () => {
    expect(parseUpdatedAfter('2026-01-02T03:04:05.000Z')).toEqual(
      new Date('2026-01-02T03:04:05.000Z'),
    );
  });

  it('throws 400 for an invalid date', () => {
    expect(() => parseUpdatedAfter('not-a-date')).toThrow(BadRequestException);
  });
});
