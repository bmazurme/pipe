import { useState } from 'react';
import { Alert, Card, SegmentedRadioGroup, Skeleton, Text } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { describeApiError, useGetLandingStatsQuery, type LandingDay } from '../../store/api';
import styles from './PromoPage.module.css';
import {
  campaignLabel,
  deviceLabel,
  langLabel,
  percent,
  sectionLabel,
  shortDay,
  sourceLabel,
  targetLabel,
} from './statsLabels';

const POLL_MS = 60_000;
const PERIODS = [
  { value: '7', title: '7 дней' },
  { value: '30', title: '30 дней' },
  { value: '90', title: '90 дней' },
];

function Tile({ title, value, hint }: { title: string; value: number; hint?: string }) {
  return (
    <Card view="outlined" className={styles.card}>
      <Text variant="body-1" color="secondary">
        {title}
      </Text>
      <Text variant="display-2">{value.toLocaleString('ru-RU')}</Text>
      {hint && (
        <Text variant="caption-2" color="secondary">
          {hint}
        </Text>
      )}
    </Card>
  );
}

// A bar per day; the height is the day's views against the busiest day, the tooltip has the numbers.
function DailyChart({ daily }: { daily: LandingDay[] }) {
  const max = Math.max(1, ...daily.map((d) => d.views));
  const summary = `Просмотры по дням, с ${shortDay(daily[0].day)} по ${shortDay(daily[daily.length - 1].day)}`;

  return (
    <div className={styles.chartBox}>
      <div className={styles.chart} role="img" aria-label={summary}>
        {daily.map((d) => (
          <div
            key={d.day}
            className={styles.chartCol}
            title={`${shortDay(d.day)}: ${d.views} просмотров, ${d.visitors} посетителей, ${d.clicks} переходов`}
          >
            <div className={styles.chartBar} style={{ height: `${Math.max(d.views > 0 ? 3 : 0, (d.views / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className={styles.chartAxis}>
        <Text variant="caption-2" color="secondary">
          {shortDay(daily[0].day)}
        </Text>
        <Text variant="caption-2" color="secondary">
          максимум за день: {max}
        </Text>
        <Text variant="caption-2" color="secondary">
          {shortDay(daily[daily.length - 1].day)}
        </Text>
      </div>
    </div>
  );
}

type StatRow = { key: string; label: string; value: number; extra?: string };

// A short ranked list: each row is a name, a count and a bar showing its share of the largest one.
function RankedCard({ title, hint, unit, rows, empty }: { title: string; hint?: string; unit: string; rows: StatRow[]; empty: string }) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);

  return (
    <Card view="outlined" className={styles.card}>
      <div>
        <Text variant="subheader-2">{title}</Text>
        {hint && (
          <Text variant="caption-2" color="secondary" as="div">
            {hint}
          </Text>
        )}
      </div>
      {rows.length === 0 ? (
        <Text variant="body-1" color="secondary">
          {empty}
        </Text>
      ) : (
        <ul className={styles.plainList}>
          {rows.map((row) => (
            <li key={row.key} className={styles.rankRow}>
              <span className={styles.rankBar} style={{ width: `${percent(row.value, total)}%` }} />
              <span className={styles.rankLabel}>
                <span className={styles.rankName}>{row.label}</span>
                {row.extra && (
                  <Text variant="caption-2" color="secondary">
                    {row.extra}
                  </Text>
                )}
              </span>
              <Text variant="body-1" className={styles.rankValue}>
                {row.value.toLocaleString('ru-RU')} {unit}
              </Text>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// Visits to the landing page: views, visitors, clicks on outgoing links, where people came from and what they do.
export function StatsTab() {
  const [days, setDays] = useState('30');
  const stats = useGetLandingStatsQuery(Number(days), { pollingInterval: POLL_MS, skipPollingIfUnfocused: true });

  if (stats.isLoading) return <Skeleton style={{ height: 240 }} />;

  if (stats.error || !stats.data) {
    return <Alert theme="danger" view="filled" title="Не удалось загрузить статистику" message={describeApiError(stats.error)} />;
  }

  const data = stats.data;
  const today = data.daily[data.daily.length - 1];
  const yesterday = data.daily.length > 1 ? data.daily[data.daily.length - 2] : undefined;
  const empty = data.lastEventAt === null;

  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <SegmentedRadioGroup value={days} onUpdate={setDays} aria-label="Период">
          {PERIODS.map((period) => (
            <SegmentedRadioGroup.Option key={period.value} value={period.value}>
              {period.title}
            </SegmentedRadioGroup.Option>
          ))}
        </SegmentedRadioGroup>
        <Text variant="caption-2" color="secondary">
          {data.lastEventAt ? `Последнее событие: ${formatRelativeTime(data.lastEventAt)}` : 'Событий за период нет'}
        </Text>
      </div>

      {empty && (
        <Alert
          theme="info"
          view="filled"
          title="Данных пока нет"
          message="Счётчик работает на лендинге со скриптом статистики: он начнёт собирать визиты после выкладки такой версии страницы. Боты и ссылочные предпросмотры не считаются."
        />
      )}

      <div className={styles.tiles}>
        <Tile
          title="Просмотры"
          value={data.totals.views}
          hint={`сегодня ${today.views}${yesterday ? `, вчера ${yesterday.views}` : ''}`}
        />
        <Tile
          title="Посетители"
          value={data.totals.visitors}
          hint={`сегодня ${today.visitors}`}
        />
        <Tile
          title="Переходы по ссылкам"
          value={data.totals.clicks}
          hint={data.totals.views > 0 ? `${percent(data.totals.clicks, data.totals.views)}% от просмотров` : undefined}
        />
        <Tile title="Запуски видео" value={data.totals.plays} />
      </div>

      <Card view="outlined" className={styles.card}>
        <Text variant="subheader-2">Просмотры по дням</Text>
        <DailyChart daily={data.daily} />
      </Card>

      <div className={styles.grid}>
        <RankedCard
          title="Откуда пришли"
          hint="сайт, с которого открыли страницу"
          unit="просм."
          empty="Нет просмотров"
          rows={data.sources.map((row) => ({ key: row.name ?? '', label: sourceLabel(row.name), value: row.views }))}
        />
        <RankedCard
          title="Метки кампаний"
          hint="utm_source / utm_medium / utm_campaign из ссылки"
          unit="просм."
          empty="Ссылок с метками ещё не открывали"
          rows={data.campaigns.map((row) => ({
            key: `${row.source}|${row.medium}|${row.campaign}`,
            label: campaignLabel(row.source, row.medium, row.campaign),
            value: row.views,
            extra: `${row.clicks} перех.`,
          }))}
        />
        <RankedCard
          title="Куда переходят"
          hint="ссылки со страницы наружу"
          unit="перех."
          empty="Переходов нет"
          rows={data.targets.map((row) => ({ key: row.name ?? '', label: targetLabel(row.name), value: row.clicks }))}
        />
        <RankedCard
          title="Где нажимают"
          hint="раздел страницы, в котором стоит ссылка"
          unit="перех."
          empty="Переходов нет"
          rows={data.sections.map((row) => ({ key: row.name ?? '', label: sectionLabel(row.name), value: row.clicks }))}
        />
        <RankedCard
          title="Язык страницы"
          unit="просм."
          empty="Нет просмотров"
          rows={data.langs.map((row) => ({ key: row.name ?? '', label: langLabel(row.name), value: row.views }))}
        />
        <RankedCard
          title="Устройство"
          unit="просм."
          empty="Нет просмотров"
          rows={data.devices.map((row) => ({ key: row.name ?? '', label: deviceLabel(row.name), value: row.views }))}
        />
      </div>

      <Text variant="caption-2" color="secondary">
        Без cookie, без адресов и без данных браузера: посетитель — случайный ярлык на один день, поэтому один человек в разные дни считается
        разными посетителями. Блокировщики рекламы и отключённый JavaScript часть визитов скрывают, так что цифры немного занижены.
      </Text>
    </div>
  );
}
