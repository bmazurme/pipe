import { useLayoutEffect, useRef } from 'react';

import { Calendar } from '@gravity-ui/date-components';
import { DateTime } from '@gravity-ui/date-utils';

import style from './calendar.module.css';

function CalendarMonth({ minDate, maxDate, isWeekendOrHoliday, shortDays, holidays, offDays, year, month, lastDay }: {
  minDate: DateTime;
  maxDate: DateTime;
  isWeekendOrHoliday: (t: DateTime) => boolean;
  shortDays: string[];
  holidays: string[];
  offDays: string[];
  year: string;
  month: number;
  lastDay: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const buttons = containerRef.current?.querySelectorAll<HTMLElement>(
      '.g-date-calendar__current-state .g-date-calendar__button:not(.g-date-calendar__button_out-of-boundary)'
    );

    buttons?.forEach((button, index) => {
      const day = index + 1;
      if (day > lastDay) {
        return;
      }

      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isShortDay = shortDays.includes(dateStr);
      const isHoliday = holidays.includes(dateStr);

      button.classList.toggle(style.shortDay, isShortDay);
      button.classList.toggle(style.holiday, isHoliday);
      button.classList.toggle(style.offDay, offDays.includes(dateStr) && !isShortDay && !isHoliday);
    });
  });

  return (
    <div
      className={style.item}
      ref={containerRef}>
      <Calendar
        mode="days"
        size="m"
        focusedValue={minDate}
        minValue={minDate}
        maxValue={maxDate}
        isWeekend={isWeekendOrHoliday}
      />
    </div>
  )
}

export default CalendarMonth;
