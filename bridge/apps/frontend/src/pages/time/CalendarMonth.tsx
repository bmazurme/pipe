import { useLayoutEffect, useRef } from 'react';
import { Calendar } from '@gravity-ui/date-components';
import { DateTime } from '@gravity-ui/date-utils';
import { Card, Label, Text } from '@gravity-ui/uikit';

import { DayOffType } from '../../store/api';
import styles from '../TimePage.module.css';

interface CalendarMonthProps {
  title: string;
  minDate: DateTime;
  maxDate: DateTime;
  isWeekendOrDayOff: (date: DateTime) => boolean;
  dateTypes: Map<string, DayOffType>;
  lastDay: number;
  /** The month containing today — accented so it's findable among twelve. */
  isCurrent?: boolean;
}

function todayKey(): string {
  const now = new Date();

  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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
  isCurrent,
}: CalendarMonthProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const buttons = containerRef.current?.querySelectorAll<HTMLElement>(
      '.g-date-calendar__current-state .g-date-calendar__button:not(.g-date-calendar__button_out-of-boundary)',
    );
    const today = todayKey();

    buttons?.forEach((button, index) => {
      const day = index + 1;
      if (day > lastDay) return;

      const dateStr = `${minDate.year()}-${String(minDate.month() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const type = dateTypes.get(dateStr);
      button.classList.toggle('dayOff', type === 'off');
      button.classList.toggle('holiday', type === 'holiday');
      button.classList.toggle('short', type === 'short');
      button.classList.toggle('compensatory', type === 'compensatory');
      button.classList.toggle('today', dateStr === today);
    });
  });

  return (
    <Card
      view="outlined"
      className={[styles.monthCard, isCurrent && styles.monthCardCurrent]
        .filter(Boolean)
        .join(' ')}
      ref={containerRef}
    >
      <div className={styles.monthTitleRow}>
        <Text variant="subheader-1" className={styles.monthTitle}>
          {title}
        </Text>
        {isCurrent && (
          <Label theme="normal" size="xs">
            Сейчас
          </Label>
        )}
      </div>
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
