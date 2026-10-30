import { useState } from 'react';
import { CircleDollar } from '@gravity-ui/icons';
import { Alert, Card, Label, Link as UiLink, Select, Skeleton, Text } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../shared/lib/formatRelativeTime';
import { getErrorMessage, type UsageTaskKind, type UsageTaskRow, type UsageTotals, useGetUsageReportQuery } from '../store/api';
import { formatCost, formatDuration, formatTokens } from '../shared/lib/usageFormat';
import { EmptyState } from '../widgets/EmptyState';
import { PageHeader } from '../widgets/PageHeader';
import styles from './UsagePage.module.css';

const PERIODS = [
  { value: '7', content: '7 дней' },
  { value: '30', content: '30 дней' },
  { value: '90', content: '90 дней' },
];

const KIND_LABEL: Record<UsageTaskKind, string> = {
  improve: 'Improve',
  lab: 'Lab',
  analysis: 'Анализ',
  parcel: 'Посылка',
};

const OUTCOME_LABEL: Record<string, string> = {
  pr_open: 'PR открыт',
  pr_updated: 'PR обновлён',
  pr_merged: 'PR влит',
  pr_closed: 'PR закрыт',
  issue_open: 'создан issue',
  no_changes: 'без изменений',
  failed: 'ошибка',
  cancelled: 'отменено',
  running: 'идёт',
  queued: 'в очереди',
};

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card view="outlined" className={styles.stat}>
      <Text variant="caption-2" color="secondary">
        {label}
      </Text>
      <Text variant="header-1">{value}</Text>
      {note && (
        <Text variant="caption-2" color="secondary">
          {note}
        </Text>
      )}
    </Card>
  );
}

function TotalsCells({ row }: { row: UsageTotals }) {
  return (
    <>
      <td className={styles.num}>
        {row.jobs}
        {row.failed > 0 && <span className={styles.failed}> ({row.failed} ош.)</span>}
      </td>
      <td className={styles.num}>{formatDuration(row.machineSeconds)}</td>
      <td className={styles.num}>{formatTokens(row.tokens)}</td>
      <td className={styles.num}>{formatCost(row.costUsd)}</td>
    </>
  );
}

function TaskRow({ task }: { task: UsageTaskRow }) {
  return (
    <tr>
      <td>
        <Label size="xs" theme="unknown">
          {KIND_LABEL[task.kind]}
        </Label>{' '}
        {task.title}
        <div className={styles.sub}>{formatRelativeTime(task.lastAt)}</div>
      </td>
      <TotalsCells row={task} />
      <td>
        {task.prNumber !== null &&
          (task.prUrl ? (
            <UiLink href={task.prUrl} target="_blank" rel="noreferrer">
              PR #{task.prNumber}
            </UiLink>
          ) : (
            `PR #${task.prNumber}`
          ))}
        {task.outcome && <div className={styles.sub}>{OUTCOME_LABEL[task.outcome] ?? task.outcome}</div>}
      </td>
    </tr>
  );
}

// What the agent cost and what it produced, from the jobs bridge already keeps. The price is the Claude CLI's own figure at API rates —
// a yardstick for comparing tasks and models, not what a subscription plan charges.
export function UsagePage() {
  const [days, setDays] = useState('30');
  const { data, isLoading, isError, error } = useGetUsageReportQuery(Number(days));

  return (
    <div className={styles.page}>
      <PageHeader
        title="Расходы"
        description="Сколько времени машины, токенов и условных долларов ушло на запуски агента и что из этого вышло. Стоимость — по тарифам API так, как её считает сам Claude CLI: ориентир для сравнения задач и моделей, а не счёт."
      />

      <div className={styles.toolbar}>
        <Select size="m" label="Период:" value={[days]} options={PERIODS} onUpdate={([value]) => setDays(value ?? '30')} />
      </div>

      {isLoading && <Skeleton style={{ height: 160 }} />}
      {isError && <Alert theme="danger" view="filled" message={getErrorMessage(error, 'Не удалось загрузить отчёт')} />}

      {data && data.totals.jobs === 0 && <EmptyState icon={CircleDollar} title="За период запусков не было" description="Когда задачи пройдут через воркер, они появятся здесь." />}

      {data && data.totals.jobs > 0 && (
        <>
          <div className={styles.stats}>
            <Stat label="Запусков" value={String(data.totals.jobs)} note={data.totals.failed ? `с ошибкой: ${data.totals.failed}` : undefined} />
            <Stat label="Время машины" value={formatDuration(data.totals.machineSeconds)} />
            <Stat label="Токенов" value={formatTokens(data.totals.tokens)} />
            <Stat
              label="Условная стоимость"
              value={formatCost(data.totals.costUsd)}
              note={data.totals.withoutCost ? `у ${data.totals.withoutCost} запусков стоимости нет — сумма не меньше этой` : undefined}
            />
            <Stat
              label="Задач с PR"
              value={String(data.pullRequests)}
              note={data.costPerPullRequest !== null ? `в среднем ${formatCost(data.costPerPullRequest)} на задачу` : undefined}
            />
          </div>

          <Card view="outlined" className={styles.card}>
            <Text variant="subheader-2">По моделям</Text>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Модель</th>
                  <th className={styles.num}>Запусков</th>
                  <th className={styles.num}>Время</th>
                  <th className={styles.num}>Токены</th>
                  <th className={styles.num}>Стоимость</th>
                </tr>
              </thead>
              <tbody>
                {data.byModel.map((row) => (
                  <tr key={row.model}>
                    <td>{row.model}</td>
                    <TotalsCells row={row} />
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card view="outlined" className={styles.card}>
            <Text variant="subheader-2">По задачам (дорогие сверху)</Text>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Задача</th>
                  <th className={styles.num}>Запусков</th>
                  <th className={styles.num}>Время</th>
                  <th className={styles.num}>Токены</th>
                  <th className={styles.num}>Стоимость</th>
                  <th>Результат</th>
                </tr>
              </thead>
              <tbody>
                {data.tasks.map((task) => (
                  <TaskRow key={task.key} task={task} />
                ))}
              </tbody>
            </table>
            <Text variant="caption-2" color="secondary">
              Ремонт CI относится к своей задаче: в её стоимость входит то, во что обошлось довести PR до зелёного. Чаты в отчёт не входят.
            </Text>
          </Card>
        </>
      )}
    </div>
  );
}
