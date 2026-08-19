import { useLayoutEffect, useRef } from 'react';
import { Calendar } from '@gravity-ui/date-components';
import { DateTime } from '@gravity-ui/date-utils';
import { Card, Text } from '@gravity-ui/uikit';

import { DayOffType } from '../../store/api';
import styles from '../TimePage.module.css';

interface CalendarMonthProps {
  title: string;
  minDate: DateTime;
  maxDate: DateTime;
  isWeekendOrDayOff: (date: DateTime) => boolean;
  dateTypes: Map<string, DayOffType>;
  lastDay: number;
}

// The library renders each day as a plain button with no per-date data
// attribute, so marking a day off/holiday/short day (as opposed to a native
// weekend, which the Calendar already styles via `isWeekend`) means walking
// the rendered DOM after each render and toggling a class by button index.
// Mirrors the approach used by the reference `reports` app's calendar page.
export function CalendarMonth({
  title,
  minDate,
  maxDate,
  isWeekendOrDayOff,
  dateTypes,
  lastDay,
}: CalendarMonthProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const buttons = containerRef.current?.querySelectorAll<HTMLElement>(
      '.g-date-calendar__current-state .g-date-calendar__button:not(.g-date-calendar__button_out-of-boundary)',
    );

    buttons?.forEach((button, index) => {
      const day = index + 1;
      if (day > lastDay) return;

      const dateStr = `${minDate.year()}-${String(minDate.month() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const type = dateTypes.get(dateStr);
      button.classList.toggle('dayOff', type === 'off');
      button.classList.toggle('holiday', type === 'holiday');
      button.classList.toggle('short', type === 'short');
    });
  });

  return (
    <Card view="outlined" className={styles.monthCard} ref={containerRef}>
      <Text variant="subheader-1" className={styles.monthTitle}>
        {title}
      </Text>
      <Calendar
        mode="days"
        size="m"
        focusedValue={minDate}
        minValue={minDate}
        maxValue={maxDate}
        isWeekend={isWeekendOrDayOff}
      />
    </Card>
  );
}
