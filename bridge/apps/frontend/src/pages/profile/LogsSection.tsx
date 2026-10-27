import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Receipt } from '@gravity-ui/icons';
import { Alert, Button, Card, Icon, Label, SegmentedRadioGroup, Select, Skeleton, Text, TextInput } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import {
  describeApiError,
  getErrorMessage,
  LogLevel,
  LogSource,
  useExportLogsMutation,
  useGetLogSummaryQuery,
  useListLogsQuery,
} from '../../store/api';
import { EmptyState } from '../../widgets/EmptyState';
import { useIsNonOwner } from '../../store/hooks';
import { OwnerOnlyNotice } from '../../widgets/OwnerOnly';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../ProfilePage.module.css';
import { formatMs, formatPercent, searchTermFromNormalized } from './logFormat';

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
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [exportError, setExportError] = useState<string | null>(null);
  const [activeRow, setActiveRow] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);

    return () => clearTimeout(timer);
  }, [search]);

  // Logs are owner-only: another account gets the notice instead of two requests bound to fail.
  const isNonOwner = useIsNonOwner();

  const {
    data: summary,
    isLoading: isSummaryLoading,
    isError: isSummaryError,
    error: summaryError,
    refetch: refetchSummary,
  } = useGetLogSummaryQuery(days, { skip: isNonOwner });
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
    ...(debouncedSearch ? { q: debouncedSearch } : {}),
    ...(onlyProblems ? { problems: true } : {}),
  }, { skip: isNonOwner });
  const [exportLogs, { isLoading: isExporting }] = useExportLogsMutation();

  const visible = entries ?? [];

  const applyDrillDown = (rowKey: string, message: string, problemsOnly: boolean) => {
    if (activeRow === rowKey) {
      setActiveRow(null);
      setSearch('');

      return;
    }

    const term = searchTermFromNormalized(message);

    if (!term) return;

    setActiveRow(rowKey);
    setSearch(term);
    if (problemsOnly) setOnlyProblems(true);
    listRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  const handleSearchChange = (value: string) => {
    setActiveRow(null);
    setSearch(value);
  };

  const handleExport = async () => {
    setExportError(null);

    try {
      await exportLogs(days).unwrap();
    } catch (err) {
      setExportError(getErrorMessage(err, 'Не удалось выгрузить логи'));
    }
  };

  const isForbidden = [summaryError, listError].some(
    (err) => typeof err === 'object' && err !== null && 'status' in err && err.status === 403,
  );

  if (isNonOwner) {
    return (
      <Card view="outlined" className={styles.card}>
        <OwnerOnlyNotice />
      </Card>
    );
  }

  if (isForbidden) {
    return (
      <Card view="outlined" className={styles.card}>
        <EmptyState icon={Receipt} title="Логи недоступны" description="Системные логи видит только владелец развёртывания." />
      </Card>
    );
  }

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
            message={`Не удалось загрузить сводку — ${describeApiError(summaryError)}`}
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
              <button
                key={item.message}
                type="button"
                className={`${styles.logRow} ${styles.logRowButton}`}
                aria-pressed={activeRow === `error:${item.message}`}
                aria-label={`Показать события: ${item.message}, ${item.count}`}
                onClick={() => applyDrillDown(`error:${item.message}`, item.message, true)}
              >
                <Text variant="body-2" ellipsis title={item.message}>{item.message}</Text>
                <Label theme="danger" size="s">×{item.count}</Label>
              </button>
            ))}
          </div>
        )}

        {summary && summary.slowestRoutes.length > 0 && (
          <div className={styles.logBlock}>
            <Text variant="subheader-1">Самые медленные запросы</Text>
            {summary.slowestRoutes.map((item) => (
              <button
                key={item.route}
                type="button"
                className={`${styles.logRow} ${styles.logRowButton}`}
                aria-pressed={activeRow === `route:${item.route}`}
                aria-label={`Показать события: ${item.route}, до ${formatMs(item.maxMs)}`}
                onClick={() => applyDrillDown(`route:${item.route}`, item.route, false)}
              >
                <Text variant="code-inline-2" ellipsis title={item.route}>{item.route}</Text>
                <Label theme="warning" size="s">до {formatMs(item.maxMs)}</Label>
              </button>
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
        <TextInput value={search} onUpdate={handleSearchChange} placeholder="Поиск по сообщению" label="Поиск по сообщению" hasClear size="m" />

        <div ref={listRef} />
        {isListLoading ? (
          <Skeleton className={styles.logsSkeleton} />
        ) : isListError ? (
          <Alert
            theme="danger"
            message={`Не удалось загрузить события — ${describeApiError(listError)}`}
            actions={<Button view="outlined" size="m" onClick={() => void refetchList()}>Повторить</Button>}
          />
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
