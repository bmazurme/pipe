import { TableColumnConfig, Label, type LabelProps } from '@gravity-ui/uikit';
import type { KeyType } from '@reports/shared';

import { RowData } from './hocs/with-table-sorting';
import reportStyle from './components/report/report.module.css';

export const months = [
  { value: '1', content: 'Январь' },
  { value: '2', content: 'Февраль' },
  { value: '3', content: 'Март' },
  { value: '4', content: 'Апрель' },
  { value: '5', content: 'Май' },
  { value: '6', content: 'Июнь' },
  { value: '7', content: 'Июль' },
  { value: '8', content: 'Август' },
  { value: '9', content: 'Сентябрь' },
  { value: '10', content: 'Октябрь' },
  { value: '11', content: 'Ноябрь' },
  { value: '12', content: 'Декабрь' },
];

export const years = [
  { value: '2025', content: '2025' },
  { value: '2026', content: '2026' },
];

export const fields: Record<KeyType, string> = {
  allDays: 'Всего дней',
  holidays: 'Праздники',
  weekends: 'Выходные',
  offDays: 'Отгулы',
  shortDays: 'Короткие дни',
  workDays: 'Рабочие дни',
  hours: 'Норма часов'
};

const statusThemes: Record<string, LabelProps['theme']> = {
  'Закрыта': 'success',
  'В работе': 'info',
};

export const getColumns = (isMobile: boolean): TableColumnConfig<RowData>[] => [
  { id: 'name', name: 'Наименование задачи', align: 'start', meta: { sort: true } },
  {
    id: 'status',
    name: 'Статус задачи',
    align: 'start',
    width: isMobile ? 110 : 130,
    meta: { sort: true },
    template: ({ status }) => (
      <Label theme={statusThemes[status] ?? 'normal'}>{status}</Label>
    ),
  },
  {
    id: 'time',
    name: 'Часы',
    align: 'end',
    width: isMobile ? 56 : 70,
    className: reportStyle.timeCell,
    meta: { sort: true },
    template: ({ time }) => (time > 0 ? time : '—'),
  },
];
