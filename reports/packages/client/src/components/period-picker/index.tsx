import { Button, Icon, Select, Tooltip } from '@gravity-ui/uikit';
import { ChevronLeft, ChevronRight } from '@gravity-ui/icons';
import type { MonthKeyType } from '@reports/shared';

import { months, years } from '../../constants';
import { reportSelector, setReportState } from '../../store';
import { useAppDispatch, useAppSelector } from '../../hooks';

import style from './period-picker.module.css';

const yearValues = years.map(({ value }) => value);

type PeriodPickerProps = {
  /** Hide the month control on pages that only depend on the year */
  withMonth?: boolean;
}

function PeriodPicker({ withMonth = true }: PeriodPickerProps) {
  const dispatch = useAppDispatch();
  const state = useAppSelector(reportSelector);

  const shiftMonth = (delta: number) => {
    const index = Number(state.month) - 1 + delta;
    const yearIndex = yearValues.indexOf(state.year) + Math.floor(index / 12);
    const month = String(((index % 12) + 12) % 12 + 1) as MonthKeyType;

    if (yearIndex < 0 || yearIndex > yearValues.length - 1) {
      return;
    }

    dispatch(setReportState({ month, year: yearValues[yearIndex] }));
  };

  const canShift = (delta: number) => {
    const index = Number(state.month) - 1 + delta;
    const yearIndex = yearValues.indexOf(state.year) + Math.floor(index / 12);

    return yearIndex >= 0 && yearIndex <= yearValues.length - 1;
  };

  return (
    <div className={style.picker}>
      {withMonth && (
        <Tooltip content="Предыдущий месяц">
          <Button
            view="outlined"
            size="m"
            disabled={!canShift(-1)}
            onClick={() => shiftMonth(-1)}
            aria-label="Предыдущий месяц"
          >
            <Icon data={ChevronLeft} size={16} />
          </Button>
        </Tooltip>
      )}
      {withMonth && (
        <Select
          value={[state.month]}
          className={style.month}
          onUpdate={([month]) => dispatch(setReportState({ ...state, month: month as MonthKeyType }))}
          options={months}
          aria-label="Месяц"
        />
      )}
      <Select
        value={[state.year]}
        className={style.year}
        onUpdate={([year]) => dispatch(setReportState({ ...state, year }))}
        options={years}
        aria-label="Год"
      />
      {withMonth && (
        <Tooltip content="Следующий месяц">
          <Button
            view="outlined"
            size="m"
            disabled={!canShift(1)}
            onClick={() => shiftMonth(1)}
            aria-label="Следующий месяц"
          >
            <Icon data={ChevronRight} size={16} />
          </Button>
        </Tooltip>
      )}
    </div>
  )
}

export default PeriodPicker;
