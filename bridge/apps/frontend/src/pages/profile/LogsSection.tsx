import { useState } from 'react';
import { ArrowDownToLine, Receipt } from '@gravity-ui/icons';
import { Alert, Button, Card, Icon, Label, SegmentedRadioGroup, Select, Skeleton, Text } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import {
  getErrorMessage,
  LogLevel,
  LogSource,
  useExportLogsMutation,
  useGetLogSummaryQuery,
  useListLogsQuery,
} from '../../store/api';
import { EmptyState } from '../../widgets/EmptyState';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../ProfilePage.module.css';
import { formatMs, formatPercent } from './logFormat';

const LEVEL_THEME: Record<LogLevel, 'normal' | 'warning' | 'danger'> = { info: 'normal', warn: 'warning', error: 'danger' };
const SOURCE_OPTIONS: { value: LogSource | 'all'; content: string }[] = [
  { value: 'all', content: 'Все источники' },
  { value: 'job', content: 'Задачи worker' },
  { value: 'http', content: 'HTTP' },
  { value: 'loop', content: 'Пайплайн (loop)' },
  { value: 'integration', content: 'Интеграции' },
  { value: 'system', content: 'Система' },
];

export function LogsSection() {
  const [days, setDays] = useState(7);
  const [source, setSource] = useState<LogSource | 'all'>('all');
  const [onlyProblems, setOnlyProblems] = useState(true);
  const [exportError, setExportError] = useState<string | null>(null);

  const {
    data: summary,
    isLoading: isSummaryLoading,
    isError: isSummaryError,
    error: summaryError,
    refetch: refetchSummary,
  } = useGetLogSummaryQuery(days);
  const {
    data: entries,
    isLoading: isListLoading,
    isError: isListError,
    error: listError,
    refetch: refetchList,
  } = useListLogsQuery({
    days,
    limit: 30,
    ...(source !== 'all' ? { source } : {}),
    // "Problems" = warnings and errors; the API filters one level at a time, so
    // an unfiltered list is trimmed here instead.
  });
  const [exportLogs, { isLoading: isExporting }] = useExportLogsMutation();

  const visible = (entries ?? []).filter((entry) => !onlyProblems || entry.level !== 'info');
  const onlyInfoReturned = onlyProblems && (entries?.length ?? 0) > 0 && visible.length === 0;

  const handleExport = async () => {
    setExportError(null);

    try {
      await exportLogs(days).unwrap();
    } catch (err) {
      setExportError(getErrorMessage(err, 'Не удалось выгрузить логи'));
    }
  };

  return (
    <Card view="outlined" className={styles.card}>
      <div className={styles.form}>
        <SectionHeader
          title="Логи для улучшения"
          actions={
            <Button view="outlined" size="m" loading={isExporting} onClick={() => void handleExport()}>
              <Icon data={ArrowDownToLine} size={16} />
              Скачать NDJSON
            </Button>
          }
        />
        <Text color="secondary" variant="body-2">
          Исходы задач worker, события пайплайна, ошибки и медленные запросы. Без тел запросов, адресов с параметрами и секретов; хранятся 30 дней.
        </Text>

        <SegmentedRadioGroup value={String(days)} onUpdate={(value) => setDays(Number(value))} size="m" aria-label="Период">
          <SegmentedRadioGroup.Option value="1">24 ч</SegmentedRadioGroup.Option>
          <SegmentedRadioGroup.Option value="7">7 дней</SegmentedRadioGroup.Option>
          <SegmentedRadioGroup.Option value="30">30 дней</SegmentedRadioGroup.Option>
        </SegmentedRadioGroup>

        {isSummaryLoading ? (
          <Skeleton className={styles.logsSkeleton} />
        ) : isSummaryError ? (
          <Alert
            theme="danger"
            message={getErrorMessage(summaryError, 'Не удалось загрузить логи')}
            actions={<Button view="outlined" size="m" onClick={() => void refetchSummary()}>Повторить</Button>}
          />
        ) : summary ? (
          <div className={styles.statGrid}>
            <div className={styles.stat}>
              <Text variant="header-1">{formatPercent(summary.jobs.successRate)}</Text>
              <Text variant="caption-2" color="secondary">
                задач успешно ({summary.jobs.succeeded} из {summary.jobs.succeeded + summary.jobs.failed})
              </Text>
            </div>
            <div className={styles.stat}>
              <Text variant="header-1">{formatMs(summary.jobs.avgDurationMs)}</Text>
              <Text variant="caption-2" color="secondary">среднее время задачи</Text>
            </div>
            <div className={styles.stat}>
              <Text variant="header-1">{summary.byLevel.error ?? 0}</Text>
              <Text variant="caption-2" color="secondary">ошибок · {summary.byLevel.warn ?? 0} предупреждений</Text>
            </div>
          </div>
        ) : null}

        {summary && summary.topErrors.length > 0 && (
          <div className={styles.logBlock}>
            <Text variant="subheader-1">Частые причины сбоев</Text>
            {summary.topErrors.map((item) => (
              <div key={item.message} className={styles.logRow}>
                <Text variant="body-2" ellipsis title={item.message}>{item.message}</Text>
                <Label theme="danger" size="s">×{item.count}</Label>
              </div>
            ))}
          </div>
        )}

        {summary && summary.slowestRoutes.length > 0 && (
          <div className={styles.logBlock}>
            <Text variant="subheader-1">Самые медленные запросы</Text>
            {summary.slowestRoutes.map((item) => (
              <div key={item.route} className={styles.logRow}>
                <Text variant="code-inline-2" ellipsis title={item.route}>{item.route}</Text>
                <Label theme="warning" size="s">до {formatMs(item.maxMs)}</Label>
              </div>
            ))}
          </div>
        )}

        <div className={styles.logFilters}>
          <Select
            value={[source]}
            onUpdate={([value]) => setSource(value as LogSource | 'all')}
            options={SOURCE_OPTIONS}
            size="m"
            aria-label="Источник"
          />
          <SegmentedRadioGroup value={onlyProblems ? 'problems' : 'all'} onUpdate={(value) => setOnlyProblems(value === 'problems')} size="m" aria-label="Уровень">
            <SegmentedRadioGroup.Option value="problems">Проблемы</SegmentedRadioGroup.Option>
            <SegmentedRadioGroup.Option value="all">Все события</SegmentedRadioGroup.Option>
          </SegmentedRadioGroup>
        </div>

        {isListLoading ? (
          <Skeleton className={styles.logsSkeleton} />
        ) : isListError ? (
          <Alert
            theme="danger"
            message={getErrorMessage(listError, 'Не удалось загрузить логи')}
            actions={<Button view="outlined" size="m" onClick={() => void refetchList()}>Повторить</Button>}
          />
        ) : onlyInfoReturned ? (
          <EmptyState icon={Receipt} title="Проблем не найдено" description="Среди последних 30 событий нет предупреждений и ошибок" />
        ) : visible.length === 0 ? (
          <EmptyState icon={Receipt} title="Событий нет" description="За выбранный период ничего не записано." />
        ) : (
          <ul className={styles.logList}>
            {visible.map((entry) => (
              <li key={entry.id} className={styles.logEntry}>
                <Label theme={LEVEL_THEME[entry.level]} size="xs">{entry.level}</Label>
                <div className={styles.logEntryMain}>
                  <Text variant="body-2" title={entry.message}>{entry.message}</Text>
                  <Text variant="caption-2" color="secondary">
                    {entry.source} · {entry.event} · {formatRelativeTime(entry.createdAt)}
                  </Text>
                </div>
              </li>
            ))}
          </ul>
        )}

        {exportError && <Alert theme="danger" view="filled" message={exportError} />}
      </div>
    </Card>
  );
}
