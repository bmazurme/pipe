import { Button } from '@gravity-ui/uikit';

import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { timeYearSelector, yearChanged } from '../../store/slices';
import { PeriodStepper } from '../../widgets/PeriodStepper';
import styles from '../TimePage.module.css';

/**
 * The year control shared by the calendar and the day-offs tab — both read the
 * same persisted year, so they must offer the same way to change it.
 */
export function YearSwitcher() {
  const dispatch = useAppDispatch();
  const year = useAppSelector(timeYearSelector);
  const currentYear = new Date().getFullYear();

  return (
    <div className={styles.periodSwitcher}>
      <PeriodStepper
        value={year}
        onStep={(delta) => dispatch(yearChanged(year + delta))}
        prevLabel="Предыдущий год"
        nextLabel="Следующий год"
        valueClassName={styles.yearValue}
      />

      {/* The year survives reloads, so a user can come back weeks later parked
          on a year they no longer care about — and stepping back from, say,
          2030 is five clicks. Offered only when there is somewhere to go. */}
      {year !== currentYear && (
        <Button view="flat" size="m" onClick={() => dispatch(yearChanged(currentYear))}>
          Текущий год
        </Button>
      )}
    </div>
  );
}
