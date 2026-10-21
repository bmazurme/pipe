import { describe, expect, it } from 'vitest';

import { formatWeekdays } from './weekdays';

describe('formatWeekdays', () => {
  it('says every day for none or all seven', () => {
    expect(formatWeekdays(null)).toBe('каждый день');
    expect(formatWeekdays([1, 2, 3, 4, 5, 6, 7])).toBe('каждый день');
  });

  it('turns three or more days in a row into a range', () => {
    expect(formatWeekdays([1, 2, 3, 4, 5])).toBe('Пн–Пт');
    expect(formatWeekdays([1, 3, 5])).toBe('Пн, Ср, Пт');
    expect(formatWeekdays([7, 6])).toBe('Сб, Вс');
    expect(formatWeekdays([1, 2, 3, 6])).toBe('Пн–Ср, Сб');
  });
});
