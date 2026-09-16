import { useMemo } from 'react';
import { Alert, Loader, Text } from '@gravity-ui/uikit';
import { dateTime, DateTime } from '@gravity-ui/date-utils';

import { useListDayOffsQuery } from '../../store/api';
import { useAppSelector } from '../../store/hooks';
import { timeYearSelector } from '../../store/slices';
import styles from '../TimePage.module.css';
import { CalendarMonth } from './CalendarMonth';
import { YearSwitcher } from './YearSwitcher';

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function CalendarTab() {
  const year = useAppSelector(timeYearSelector);
  const { data: dayOffs = [], isLoading, isError } = useListDayOffsQuery(year);

  const today = new Date();
  const currentMonth =
    today.getFullYear() === year ? today.getMonth() + 1 : null;

  const dateTypes = useMemo(() => new Map(dayOffs.map((dayOff) => [dayOff.date, dayOff.type])), [dayOffs]);

  // "off" and "holiday" count as non-working. "short" stays a working day
  // (just fewer hours). "compensatory" is the inverse of all three — a
  // weekend swapped in as a working day — so it force-overrides the native
  // Sat/Sun check rather than adding to it.
  const isWeekendOrDayOff = (date: DateTime): boolean => {
    const dateStr = date.format('YYYY-MM-DD');
    const type = dateTypes.get(dateStr);
    if (type === 'off' || type === 'holiday') return true;
    if (type === 'compensatory') return false;

    const dayOfWeek = new Date(date.year(), date.month(), date.date()).getDay();
    return dayOfWeek === 0 || dayOfWeek === 6;
  };

  return (
    <div className={styles.tabPanel}>
      <YearSwitcher />

      {isError && (
        <Alert theme="danger" view="filled" message="Не удалось загрузить дни отдыха" />
      )}

      {isLoading && (
        <div className={styles.centered}>
          <Loader size="m" />
        </div>
      )}

      {!isLoading && (
        <div className={styles.grid}>
          {MONTHS.map((month) => {
            const minDate = dateTime({ input: `${year}-${String(month).padStart(2, '0')}-01`, format: 'YYYY-MM-DD' });
            const lastDay = lastDayOfMonth(year, month);
            const maxDate = dateTime({
              input: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
              format: 'YYYY-MM-DD',
            });

            return (
              <CalendarMonth
                key={month}
                title={minDate.format('MMMM')}
                minDate={minDate}
                maxDate={maxDate}
                isWeekendOrDayOff={isWeekendOrDayOff}
                dateTypes={dateTypes}
                lastDay={lastDay}
                isCurrent={month === currentMonth}
              />
            );
          })}
        </div>
      )}

      <div className={styles.legend}>
        <div className={styles.legendItem}>
          <span className={`${styles.legendColor} ${styles.legendToday}`} />
          <Text color="secondary" variant="body-2">
            Сегодня
          </Text>
        </div>
        <div className={styles.legendItem}>
          <span className={`${styles.legendColor} ${styles.legendWeekend}`} />
          <Text color="secondary" variant="body-2">
            Выходной
          </Text>
        </div>
        <div className={styles.legendItem}>
          <span className={`${styles.legendColor} ${styles.legendDayOff}`} />
          <Text color="secondary" variant="body-2">
            Day off
          </Text>
        </div>
        <div className={styles.legendItem}>
          <span className={`${styles.legendColor} ${styles.legendHoliday}`} />
          <Text color="secondary" variant="body-2">
            Праздник
          </Text>
        </div>
        <div className={styles.legendItem}>
          <span className={`${styles.legendColor} ${styles.legendShort}`} />
          <Text color="secondary" variant="body-2">
            Короткий день
          </Text>
        </div>
        <div className={styles.legendItem}>
          <span className={`${styles.legendColor} ${styles.legendCompensatory}`} />
          <Text color="secondary" variant="body-2">
            Рабочий выходной
          </Text>
        </div>
      </div>
    </div>
  );
}
