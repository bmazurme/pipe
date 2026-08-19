import { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from '@gravity-ui/icons';
import { Alert, Button, Icon, Loader, Text } from '@gravity-ui/uikit';
import { dateTime, DateTime } from '@gravity-ui/date-utils';

import { useListDayOffsQuery } from '../../store/api';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { timeYearSelector, yearChanged } from '../../store/slices';
import styles from '../TimePage.module.css';
import { CalendarMonth } from './CalendarMonth';

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function CalendarTab() {
  const dispatch = useAppDispatch();
  const year = useAppSelector(timeYearSelector);
  const { data: dayOffs = [], isLoading, isError } = useListDayOffsQuery(year);

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
      <div className={styles.yearSwitcher}>
        <Button view="flat" size="m" onClick={() => dispatch(yearChanged(year - 1))} aria-label="Предыдущий год">
          <Icon data={ChevronLeft} size={16} />
        </Button>
        <Text variant="subheader-1" className={styles.yearValue}>
          {year}
        </Text>
        <Button view="flat" size="m" onClick={() => dispatch(yearChanged(year + 1))} aria-label="Следующий год">
          <Icon data={ChevronRight} size={16} />
        </Button>
      </div>

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
              />
            );
          })}
        </div>
      )}

      <div className={styles.legend}>
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
