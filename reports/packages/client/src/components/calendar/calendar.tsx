import { useMemo, useState } from 'react';

import {
  Button, Dialog, DialogHeader, DialogBody, DialogFooter, Text, Icon, Tooltip,
  TabProvider, TabList, Tab, TabPanel, useToaster,
} from '@gravity-ui/uikit';
import { Plus, TrashBin, CalendarXmark, ArrowDownToLine } from '@gravity-ui/icons';
import { RangeDatePicker, type RangeValue } from '@gravity-ui/date-components';
import { DateTime, dateTimeParse } from '@gravity-ui/date-utils';
import { DateType } from '@reports/shared';

import { useAddOffDaysMutation, useRemoveOffDayMutation, useImportDayOffsMutation } from '../../store/api';
import { useDocumentTitle } from '../../hooks/use-document-title';
import { describeError } from '../../utils/describe-error';
import PageHeader from '../page-header';
import PeriodPicker from '../period-picker';
import { EmptyState } from '../state';

import CalendarMonth from './calendar-month';
import style from './calendar.module.css';

const TABS = {
  calendar: 'calendar',
  dayOff: 'day-off',
} as const;

const monthTitleFormatter = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const weekdayFormatter = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', timeZone: 'UTC' });

const formatMonthTitle = (monthKey: string) => {
  const [y, m] = monthKey.split('-').map(Number);
  const label = monthTitleFormatter.format(new Date(Date.UTC(y, m - 1, 1)));

  return label.charAt(0).toUpperCase() + label.slice(1);
};

const formatWeekday = (date: string) => {
  const label = weekdayFormatter.format(new Date(`${date}T00:00:00Z`));

  return label.charAt(0).toUpperCase() + label.slice(1);
};

const groupByMonth = (dates: string[]) => {
  const groups = new Map<string, string[]>();

  [...dates].sort().forEach((date) => {
    const monthKey = date.slice(0, 7);
    const group = groups.get(monthKey) ?? [];

    group.push(date);
    groups.set(monthKey, group);
  });

  return [...groups.entries()];
};

const toDateString = (t: DateTime) =>
  `${t.year()}-${String(t.month() + 1).padStart(2, '0')}-${String(t.date()).padStart(2, '0')}`;

function MyCalendar({ data, year }: { data: DateType; year: string }) {
  const toaster = useToaster();
  const [addOffDays, { isLoading: isAdding }] = useAddOffDaysMutation();
  const [removeOffDay, { isLoading: isRemoving }] = useRemoveOffDayMutation();
  const [importDayOffsRequest, { isLoading: isImporting }] = useImportDayOffsMutation();
  const [activeTab, setActiveTab] = useState<string>(TABS.calendar);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedRange, setSelectedRange] = useState<RangeValue<DateTime> | null>(null);
  const [dayToRemove, setDayToRemove] = useState<string | null>(null);

  useDocumentTitle(`Календарь ${year}`);

  const offDays = data.offDays;
  const groupedOffDays = useMemo(() => groupByMonth(offDays), [offDays]);

  const getLastDayOfMonth = (year: number, month: number) => new Date(year, month, 0).getDate();

  const isWeekendOrHoliday = (t: DateTime) => {
    const dateStr = toDateString(t);
    const dayOfWeek = new Date(Date.UTC(t.year(), t.month(), t.date())).getUTCDay();

    if (!data) {
      return false;
    }

    if (offDays.includes(dateStr)) {
      return true;
    }

    if ((dayOfWeek === 0 || dayOfWeek === 6) && !data.badDays.includes(dateStr)) {
      return true;
    }

    return data.holidays.includes(dateStr);
  };

  const handleAddDayOff = async () => {
    if (!selectedRange?.start || !selectedRange?.end) {
      return;
    }

    const dates: string[] = [];
    let current = selectedRange.start;

    while (!current.startOf('day').isAfter(selectedRange.end.startOf('day'))) {
      dates.push(toDateString(current));
      current = current.add(1, 'day');
    }

    setIsDialogOpen(false);
    setSelectedRange(null);

    try {
      await addOffDays({ year, dates }).unwrap();
      toaster.add({
        name: 'off-days-added',
        theme: 'success',
        title: dates.length === 1 ? 'Отгул добавлен' : `Добавлено дней: ${dates.length}`,
        autoHiding: 3000,
      });
    } catch (error) {
      toaster.add({
        name: 'off-days-add-error',
        theme: 'danger',
        title: 'Не удалось добавить отгулы',
        content: describeError(error),
        isClosable: true,
      });
    }
  };

  const handleRemoveOffDay = async () => {
    const date = dayToRemove;

    setDayToRemove(null);

    if (!date) {
      return;
    }

    try {
      await removeOffDay({ year, date }).unwrap();
      toaster.add({
        name: 'off-day-removed',
        theme: 'success',
        title: `${date} удалён`,
        autoHiding: 3000,
      });
    } catch (error) {
      toaster.add({
        name: 'off-day-remove-error',
        theme: 'danger',
        title: 'Не удалось удалить отгул',
        content: describeError(error),
        isClosable: true,
      });
    }
  };

  const handleImport = async () => {
    try {
      await importDayOffsRequest(year).unwrap();
      toaster.add({
        name: 'import-success',
        theme: 'success',
        title: 'Данные импортированы',
        content: 'Производственный календарь обновлён из bridge',
        autoHiding: 4000,
      });
    } catch (error) {
      toaster.add({
        name: 'import-error',
        theme: 'danger',
        title: 'Не удалось импортировать данные',
        content: describeError(error, 'Проверьте Bridge API в настройках'),
        isClosable: true,
      });
    }
  };

  return (
    <div className={style.page}>
      <PageHeader
        title="Календарь"
        description={`Производственный календарь на ${year} год`}
        actions={<PeriodPicker withMonth={false} />}
      />
      <TabProvider value={activeTab} onUpdate={setActiveTab}>
        <TabList className={style.tabs}>
          <Tab value={TABS.calendar}>Календарь</Tab>
          <Tab value={TABS.dayOff} counter={offDays.length}>Отгулы</Tab>
        </TabList>
        <TabPanel value={TABS.calendar} className={style.main}>
          <div className={style.grid}>
            {Object.keys(data.calendar).map((month) => {
              const monthNum = Number(month);
              const minDate = dateTimeParse(new Date(`${year}-${monthNum}-01`))!;
              const maxDate = dateTimeParse(new Date(`${year}-${monthNum}-${getLastDayOfMonth(Number(year), monthNum)}`))!;

              return (
                <CalendarMonth
                  key={month}
                  minDate={minDate}
                  maxDate={maxDate}
                  isWeekendOrHoliday={isWeekendOrHoliday}
                  shortDays={data.shortDays}
                  holidays={data.holidays}
                  offDays={offDays}
                  year={year}
                  month={monthNum}
                  lastDay={getLastDayOfMonth(Number(year), monthNum)}
                />
              )
            })}
          </div>
          <div className={style.legend}>
            <div className={style.legendItem}>
              <span className={`${style.legendColor} ${style.shortDay}`} />
              Короткий день
            </div>
            <div className={style.legendItem}>
              <span className={`${style.legendColor} ${style.holiday}`} />
              Праздник
            </div>
            <div className={style.legendItem}>
              <span className={`${style.legendColor} ${style.offDay}`} />
              Отпуск/отгул/больничный
            </div>
          </div>
        </TabPanel>
        <TabPanel value={TABS.dayOff} className={style.side}>
          <div className={style.addRow}>
            <Button view="action" size="m" onClick={() => setIsDialogOpen(true)} loading={isAdding}>
              <Icon data={Plus} size={16} />
              Добавить отгул
            </Button>
            <Tooltip content="Загрузить отгулы и праздники из bridge">
              <Button view="outlined" size="m" onClick={handleImport} loading={isImporting}>
                <Icon data={ArrowDownToLine} size={16} />
                Импорт
              </Button>
            </Tooltip>
          </div>
          {offDays.length === 0 ? (
            <EmptyState
              icon={<Icon data={CalendarXmark} size={28} />}
              title="Отгулов пока нет"
              description="Добавьте отпуск, отгул или больничный, чтобы они учитывались в норме часов."
              action={(
                <Button view="action" size="m" onClick={() => setIsDialogOpen(true)}>
                  <Icon data={Plus} size={16} />
                  Добавить отгул
                </Button>
              )}
            />
          ) : (
            groupedOffDays.map(([monthKey, dates]) => (
              <div key={monthKey} className={style.monthGroup}>
                <Text variant="subheader-1" className={style.monthGroupTitle}>
                  {formatMonthTitle(monthKey)} · {dates.length}
                </Text>
                <ul className={style.offDaysList}>
                  {dates.map((date) => (
                    <li key={date} className={style.offDaysItem}>
                      <div className={style.offDaysItemDate}>
                        <span className={style.offDaysDay} aria-hidden="true">{Number(date.slice(-2))}</span>
                        <div className={style.offDaysDateText}>
                          <Text variant="body-2">{formatWeekday(date)}</Text>
                          <Text variant="caption-2" color="secondary">{date}</Text>
                        </div>
                      </div>
                      <Button
                        view="flat"
                        size="s"
                        onClick={() => setDayToRemove(date)}
                        aria-label={`Удалить отгул ${date}`}
                        disabled={isRemoving}
                      >
                        <Icon data={TrashBin} size={16} />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </TabPanel>
      </TabProvider>
      <Dialog open={isDialogOpen} onClose={() => setIsDialogOpen(false)}>
        <DialogHeader caption="Добавить отгул" />
        <DialogBody>
          <Text variant="body-1" color="secondary" className={style.dialogHint}>
            Выберите период — все дни диапазона будут отмечены как нерабочие.
          </Text>
          <RangeDatePicker value={selectedRange} onUpdate={setSelectedRange} />
        </DialogBody>
        <DialogFooter
          onClickButtonCancel={() => setIsDialogOpen(false)}
          onClickButtonApply={handleAddDayOff}
          textButtonApply="Добавить"
          textButtonCancel="Отмена"
          propsButtonApply={{ disabled: !selectedRange?.start || !selectedRange?.end }}
        />
      </Dialog>
      <Dialog open={!!dayToRemove} onClose={() => setDayToRemove(null)}>
        <DialogHeader caption="Удалить отгул" />
        <DialogBody>
          Удалить {dayToRemove} из дополнительных выходных?
        </DialogBody>
        <DialogFooter
          onClickButtonCancel={() => setDayToRemove(null)}
          onClickButtonApply={handleRemoveOffDay}
          textButtonApply="Удалить"
          textButtonCancel="Отмена"
          propsButtonApply={{ view: 'outlined-danger' }}
        />
      </Dialog>
    </div>
  )
}

export default MyCalendar;
