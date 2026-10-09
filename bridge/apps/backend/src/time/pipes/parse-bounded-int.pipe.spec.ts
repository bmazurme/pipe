import { BadRequestException } from '@nestjs/common';

import {
  monthPipe,
  ParseBoundedIntPipe,
  yearPipe,
} from './parse-bounded-int.pipe';

describe('ParseBoundedIntPipe', () => {
  it('passes integers inside the range, as numbers', () => {
    expect(monthPipe().transform('7')).toBe(7);
    expect(monthPipe().transform('12')).toBe(12);
    expect(yearPipe().transform('2026')).toBe(2026);
  });

  it.each(['0', '13', '99', '-1'])('rejects month %s with a 400', (value) => {
    expect(() => monthPipe().transform(value)).toThrow(BadRequestException);
  });

  it.each(['-5', '0', '99999', '1899'])(
    'rejects year %s with a 400',
    (value) => {
      expect(() => yearPipe().transform(value)).toThrow(BadRequestException);
    },
  );

  it.each(['abc', '', '1.5', '7x', ' '])(
    'rejects %p, which is not an integer',
    (value) => {
      expect(() => monthPipe().transform(value)).toThrow(BadRequestException);
    },
  );

  it('names the field and the range in the message', () => {
    expect(() =>
      new ParseBoundedIntPipe('month', 1, 12).transform('99'),
    ).toThrow('month must be an integer from 1 to 12');
  });
});
