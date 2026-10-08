import { useMemo } from 'react';
import { Alert, Loader, Progress, Text, Tooltip } from '@gravity-ui/uikit';

import { useListDayOffsQuery, useListReportEntriesQuery } from '../../store/api';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { reportMonthStepped, reportYearChanged, timeReportMonthSelector, timeReportYearSelector } from '../../store/slices';
import { PeriodStepper } from '../../widgets/PeriodStepper';
import styles from '../TimePage.module.css';
import { monthStats, normRatio, summarizeReport } from './dashboardUtils';

const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

const hoursFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const formatHours = (value: number) => hoursFormatter.format(value);

// The month at a glance, as on reports' home page: hours booked against the month's norm,
// the task counts, and the calendar the norm comes from. Shares its period with the Report
// tab, so stepping the month here and there stays in step.
export function DashboardTab() {
  const dispatch = useAppDispatch();
  const year = useAppSelector(timeReportYearSelector);
  const month = useAppSelector(timeReportMonthSelector);

  const { data: entries = [], isLoading: entriesLoading, isError: entriesError } = useListReportEntriesQuery({ year, month });
  const { data: dayOffs = [], isLoading: dayOffsLoading, isError: dayOffsError } = useListDayOffsQuery(year);

  const stats = useMemo(() => monthStats(year, month, dayOffs), [year, month, dayOffs]);
  const summary = useMemo(() => summarizeReport(entries), [entries]);

  const ratio = normRatio(summary.totalHours, stats.norm);
  const isOver = summary.totalHours > stats.norm;
  const remaining = Math.max(stats.norm - summary.totalHours, 0);

  const tiles = [
    { label: 'Задач всего', value: summary.tasks },
    { label: 'Закрыто', value: summary.closed },
    { label: 'В работе', value: summary.inProgress },
    { label: 'Норма, ч', value: formatHours(stats.norm) },
  ];
  const calendar = [
    { label: 'Дней в месяце', value: stats.allDays },
    { label: 'Рабочих', value: stats.workDays },
    { label: 'Выходных', value: stats.weekends },
    { label: 'Праздников', value: stats.holidays },
    { label: 'Day off', value: stats.offDays },
    { label: 'Коротких дней', value: stats.shortDays },
  ];

  return (
    <div className={styles.tabPanel}>
      <div className={styles.periodSwitcher}>
        <PeriodStepper
          value={year}
          onStep={(delta) => dispatch(reportYearChanged(year + delta))}
          prevLabel="Предыдущий год"
          nextLabel="Следующий год"
          valueClassName={styles.yearValue}
        />
        <PeriodStepper
          value={MONTH_NAMES[month - 1]}
          onStep={(delta) => dispatch(reportMonthStepped(delta))}
          prevLabel="Предыдущий месяц"
          nextLabel="Следующий месяц"
          valueClassName={styles.monthValue}
        />
      </div>

      {(entriesError || dayOffsError) && (
        <Alert theme="danger" view="filled" message="Не удалось загрузить данные за период" />
      )}

      {entriesLoading || dayOffsLoading ? (
        <div className={styles.centered}>
          <Loader size="m" />
        </div>
      ) : (
        <section className={styles.dashboard} aria-label="Сводка по месяцу">
          <div className={styles.hero}>
            <div className={styles.heroTop}>
              <div className={styles.heroValue}>
                <Text variant="display-2" className={styles.heroHours}>
                  {formatHours(summary.totalHours)}
                </Text>
                <Text variant="body-2" color="secondary">
                  из {formatHours(stats.norm)} ч нормы
                </Text>
              </div>
              <div className={styles.heroBadges}>
                <Tooltip content="Доля отработанных часов от месячной нормы">
                  <span className={`${styles.badge} ${isOver ? styles.badgeDanger : ''}`}>{Math.round(ratio)}%</span>
                </Tooltip>
                <Text variant="body-2" color="secondary">
                  {isOver ? `Превышение на ${formatHours(summary.totalHours - stats.norm)} ч` : `Осталось ${formatHours(remaining)} ч`}
                </Text>
              </div>
            </div>
            <Progress
              value={Math.min(ratio, 100)}
              size="s"
              className={styles.progress}
              theme={isOver ? 'danger' : undefined}
              colorStops={
                isOver
                  ? undefined
                  : [
                      { theme: 'danger', stop: 30 },
                      { theme: 'warning', stop: 60 },
                      { theme: 'success', stop: 100 },
                    ]
              }
            />
          </div>

          {isOver && (
            <Alert
              theme="warning"
              view="filled"
              corners="rounded"
              title="Превышение нормы часов"
              message={`Списано ${formatHours(summary.totalHours)} ч при норме ${formatHours(stats.norm)} ч за месяц.`}
            />
          )}

          {summary.tasks === 0 && (
            <Text color="secondary" variant="body-2">
              За этот месяц отчёта нет — импортируйте его на вкладке «Отчёт».
            </Text>
          )}

          <div className={styles.tiles}>
            {tiles.map((tile) => (
              <div key={tile.label} className={styles.tile}>
                <Text variant="caption-2" color="secondary">
                  {tile.label}
                </Text>
                <Text variant="header-1" className={styles.tileValue}>
                  {tile.value}
                </Text>
              </div>
            ))}
          </div>

          <dl className={styles.calendarStats}>
            {calendar.map((stat) => (
              <div key={stat.label} className={styles.calendarStat}>
                <dt>
                  <Text variant="caption-2" color="secondary">
                    {stat.label}
                  </Text>
                </dt>
                <dd>
                  <Text variant="subheader-2">{stat.value}</Text>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
