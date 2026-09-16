import { Alert, Progress, Text, Tooltip } from '@gravity-ui/uikit';
import type { MonthKeyType, KeyType, DateType } from '@reports/shared';

import { fields } from '../../constants';

import style from './details.module.css';

type DetailProps = {
  total: number;
  issues: number;
  month: MonthKeyType;
  data: DateType;
  closed: number;
}

const calendarKeys: KeyType[] = ['allDays', 'workDays', 'weekends', 'holidays', 'offDays', 'shortDays'];

const hoursFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

const formatHours = (value: number) => hoursFormatter.format(value);

function Details({ month, total, issues, data, closed }: DetailProps) {
  const stats = data.calendar[month];
  const norm = stats.hours;
  const ratio = norm > 0 ? (total / norm) * 100 : 0;
  const isOver = total > norm;
  const remaining = Math.max(norm - total, 0);
  const openIssues = issues - closed;

  return (
    <section className={style.details} aria-label="Сводка по месяцу">
      <div className={style.hero}>
        <div className={style.heroTop}>
          <div className={style.heroValue}>
            <Text variant="display-2" className={style.hours}>{formatHours(total)}</Text>
            <Text variant="body-2" color="secondary">из {formatHours(norm)} ч нормы</Text>
          </div>
          <div className={style.heroBadges}>
            <Tooltip content="Доля отработанных часов от месячной нормы">
              <span className={`${style.badge} ${isOver ? style.badgeDanger : ''}`}>
                {Math.round(ratio)}%
              </span>
            </Tooltip>
            <Text variant="body-2" color="secondary">
              {isOver
                ? `Превышение на ${formatHours(total - norm)} ч`
                : `Осталось ${formatHours(remaining)} ч`}
            </Text>
          </div>
        </div>
        <Progress
          value={Math.min(ratio, 100)}
          size="s"
          theme={isOver ? 'danger' : undefined}
          colorStops={isOver ? undefined : [
            { theme: 'danger', stop: 30 },
            { theme: 'warning', stop: 60 },
            { theme: 'success', stop: 100 },
          ]}
          className={style.progress}
        />
      </div>

      {isOver && (
        <Alert
          theme="warning"
          view="filled"
          corners="rounded"
          className={style.alert}
          title="Превышение нормы часов"
          message={`Списано ${formatHours(total)} ч при норме ${formatHours(norm)} ч за месяц.`}
        />
      )}

      <div className={style.tiles}>
        <div className={style.tile}>
          <Text variant="caption-2" color="secondary" className={style.tileLabel}>Задач всего</Text>
          <Text variant="header-1" className={style.tileValue}>{issues}</Text>
        </div>
        <div className={style.tile}>
          <Text variant="caption-2" color="secondary" className={style.tileLabel}>Закрыто</Text>
          <Text variant="header-1" className={style.tileValue}>{closed}</Text>
        </div>
        <div className={style.tile}>
          <Text variant="caption-2" color="secondary" className={style.tileLabel}>В работе</Text>
          <Text variant="header-1" className={style.tileValue}>{openIssues}</Text>
        </div>
        <div className={style.tile}>
          <Text variant="caption-2" color="secondary" className={style.tileLabel}>{fields.hours}</Text>
          <Text variant="header-1" className={style.tileValue}>{norm}</Text>
        </div>
      </div>

      <dl className={style.calendarStats}>
        {calendarKeys.map((key) => (
          <div key={key} className={style.calendarStat}>
            <dt className={style.calendarStatLabel}>
              <Text variant="caption-2" color="secondary">{fields[key]}</Text>
            </dt>
            <dd className={style.calendarStatValue}>
              <Text variant="subheader-2">{stats[key]}</Text>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export default Details;
