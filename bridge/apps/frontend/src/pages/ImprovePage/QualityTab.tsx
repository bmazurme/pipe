import { useState } from 'react';
import { ChartAreaStackedNormalized } from '@gravity-ui/icons';
import { Alert, Button, Card, Select, Skeleton, Text } from '@gravity-ui/uikit';

import { getErrorMessage, type QualityFigures, type QualityGroup, useGetImproveQualityQuery, useRefreshImproveQualityMutation } from '../../store/api';
import { EmptyState } from '../../widgets/EmptyState';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from './QualityTab.module.css';

const PERIODS = [
  { value: '30', content: '30 дней' },
  { value: '90', content: '90 дней' },
  { value: '365', content: 'Год' },
];

const percent = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)} %`);
const usd = (value: number | null) => (value === null ? '—' : `$${value.toFixed(2)}`);
const hours = (value: number | null) => (value === null ? '—' : value < 1 ? `${Math.round(value * 60)} мин` : `${value.toFixed(1)} ч`);
const plain = (value: number | null) => (value === null ? '—' : String(value));

const tierLabel = (key: string) => (key === 'none' ? 'без яруса (модель задана)' : `ярус ${key}`);

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className={styles.tile} title={hint}>
      <Text variant="header-1">{value}</Text>
      <Text color="secondary" variant="caption-2">
        {label}
      </Text>
    </div>
  );
}

function Table({ title, firstColumn, groups, label }: { title: string; firstColumn: string; groups: QualityGroup[]; label: (key: string) => string }) {
  if (groups.length === 0) return null;

  return (
    <div className={styles.block}>
      <Text variant="subheader-1">{title}</Text>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{firstColumn}</th>
              <th scope="col">PR</th>
              <th scope="col">влито</th>
              <th scope="col" title="Доля PR, у которых CI был зелёным с первой попытки">
                с 1-го раза
              </th>
              <th scope="col" title="Автоматических ремонтов CI на один влитый PR">
                ремонтов
              </th>
              <th scope="col" title="Медиана от открытия до слияния">
                до слияния
              </th>
              <th scope="col" title="Всё потраченное, делённое на число влитых: закрытый без слияния PR — расход без результата">
                за влитый
              </th>
              <th scope="col">откатов</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.key}>
                <th scope="row">{label(group.key)}</th>
                <td>{group.opened}</td>
                <td>{group.merged}</td>
                <td>{percent(group.firstGreenRate)}</td>
                <td>{plain(group.repairsPerMerged)}</td>
                <td>{hours(group.medianHoursToMerge)}</td>
                <td>{usd(group.costPerMergedUsd)}</td>
                <td>{percent(group.revertRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tiles({ total }: { total: QualityFigures }) {
  return (
    <div className={styles.tiles}>
      <Tile label="PR открыто / влито" value={`${total.opened} / ${total.merged}`} hint={`Закрыто без слияния: ${total.closed}; ещё открыто: ${total.open}`} />
      <Tile label="CI зелёный с 1-го раза" value={percent(total.firstGreenRate)} hint="Результат CI на коммите, с которым PR был открыт, до любых ремонтов" />
      <Tile label="Ремонтов CI на влитый PR" value={plain(total.repairsPerMerged)} hint="Автоматические заходы на исправление после красного CI" />
      <Tile label="До слияния (медиана)" value={hours(total.medianHoursToMerge)} hint="От открытия PR до слияния; ждёт и вас тоже" />
      <Tile
        label="Стоимость на влитый PR"
        value={usd(total.costPerMergedUsd)}
        hint={`Цифра Claude CLI (эквивалент цены API, не счёт по подписке). Не сообщили стоимость: ${total.withoutCost} PR — сумма на них занижена.`}
      />
      <Tile label="Откатов" value={percent(total.revertRate)} hint="Доля влитых PR, которые позже откатил другой PR (Revert …)" />
    </div>
  );
}

// A1: how good the assistant is, in numbers. These are the figures any change of a prompt, a model or the router is judged by (A4).
export function QualityTab() {
  const [days, setDays] = useState('90');
  const { data, isLoading, isError, error } = useGetImproveQualityQuery(Number(days));
  const [refresh, { isLoading: refreshing, data: refreshed, error: refreshError }] = useRefreshImproveQualityMutation();

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader
        title="Качество помощника"
        icon={ChartAreaStackedNormalized}
        actions={
          <div className={styles.controls}>
            <Select size="m" width={120} value={[days]} options={PERIODS} onUpdate={(value) => setDays(value[0] ?? '90')} aria-label="Период" />
            <Button view="outlined" loading={refreshing} onClick={() => void refresh()}>
              Обновить из GitHub
            </Button>
          </div>
        }
      />

      {refreshError && <Alert theme="danger" message={getErrorMessage(refreshError, 'Не удалось обновить данные из GitHub')} />}
      {refreshed && refreshed.remaining > 0 && <Alert theme="info" message={`Прочитано PR: ${refreshed.checked}. Осталось ${refreshed.remaining} — нажмите ещё раз, или они подтянутся сами в течение часа.`} />}

      {isLoading ? (
        <Skeleton style={{ height: 120 }} />
      ) : isError || !data ? (
        <Alert theme="danger" message={getErrorMessage(error, 'Не удалось загрузить показатели качества')} />
      ) : data.total.opened === 0 ? (
        <EmptyState
          icon={ChartAreaStackedNormalized}
          title="Пока нет данных"
          description="Показатели считаются по pull request'ам, которые открыл Improve, и подтягиваются с GitHub: первый раз — в течение получаса, или нажмите «Обновить из GitHub»."
        />
      ) : (
        <>
          <Tiles total={data.total} />
          <Table title="По моделям" firstColumn="Модель" groups={data.byModel} label={(key) => key} />
          <Table title="По ярусам" firstColumn="Ярус" groups={data.byTier} label={tierLabel} />
          <Text color="secondary" variant="caption-2">
            Период — по дате открытия PR. «С 1-го раза» считается только по PR, у которых CI уже закончился. Ярус ставит маршрутизатор; у запуска на заданной модели яруса нет.
          </Text>
        </>
      )}
    </Card>
  );
}
