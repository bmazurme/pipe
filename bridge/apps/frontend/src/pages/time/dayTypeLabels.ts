import { DayOffType } from '../../store/api';

/** Day-type wording shared by the day buttons' tooltips and the legend. */
export const DAY_TYPE_LABELS: Record<DayOffType | 'today', string> = {
  off: 'Day off',
  holiday: 'Праздник',
  short: 'Короткий день',
  compensatory: 'Рабочий выходной',
  today: 'Сегодня',
};
