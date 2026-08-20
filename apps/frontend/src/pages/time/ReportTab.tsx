import { ChangeEvent, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowsRotateLeft,
  ArrowUp,
  ArrowUpArrowDown,
  FileArrowUp,
  LayoutHeaderCells,
  TrashBin,
} from '@gravity-ui/icons';
import { Alert, Button, Card, Dialog, Icon, Loader, Text } from '@gravity-ui/uikit';

import {
  useDeleteReportEntriesMutation,
  useImportReportMutation,
  useListReportEntriesQuery,
} from '../../store/api';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import {
  reportMonthStepped,
  reportPeriodSet,
  reportYearChanged,
  timeReportMonthSelector,
  timeReportYearSelector,
} from '../../store/slices';
import { EmptyState } from '../../widgets/EmptyState';
import { PeriodStepper } from '../../widgets/PeriodStepper';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../TimePage.module.css';
import {
  ariaSort,
  nextSort,
  sortReportEntries,
  type ReportSort,
  type ReportSortColumn,
} from './reportSort';

const COLUMNS: { key: ReportSortColumn; title: string; numeric?: boolean }[] = [
  { key: 'taskName', title: 'Задача' },
  { key: 'status', title: 'Статус' },
  { key: 'hours', title: 'Часы', numeric: true },
];

const MONTH_NAMES = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];

export function ReportTab() {
  const dispatch = useAppDispatch();
  const year = useAppSelector(timeReportYearSelector);
  const month = useAppSelector(timeReportMonthSelector);

  const {
    data: entries = [],
    isLoading,
    isFetching,
    isError,
    refetch,
  } = useListReportEntriesQuery({ year, month });
  const [importReport, { isLoading: isImporting }] = useImportReportMutation();
  const [deleteReportEntries, { isLoading: isDeleting }] = useDeleteReportEntriesMutation();

  const inputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Sorting is client-side: a month's report is a few dozen rows that are
  // already in memory, so a round trip per column click would be pure latency.
  // The choice deliberately survives switching months — a user comparing two
  // periods by hours shouldn't have to re-sort each time.
  const [sort, setSort] = useState<ReportSort | null>(null);
  const sortedEntries = useMemo(() => sortReportEntries(entries, sort), [entries, sort]);

  const totalHours = entries.reduce((sum, entry) => sum + entry.hours, 0);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const isCurrentPeriod = year === currentYear && month === currentMonth;

  const handleFile = async (file: File) => {
    setImportError(null);
    setImportSummary(null);

    try {
      const result = await importReport(file).unwrap();
      dispatch(reportPeriodSet({ year: result.year, month: result.month }));
      setImportSummary(
        `Импортировано задач: ${result.entries.length} за ${MONTH_NAMES[result.month - 1]} ${result.year}`,
      );
    } catch (err) {
      const message = (err as { error?: string } | undefined)?.error;
      setImportError(message ?? 'Не удалось импортировать файл');
    }
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    // Snapshot before clearing value — resetting a file input's value
    // live-mutates the same FileList the browser handed back.
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (file) void handleFile(file);
  };

  const handleDelete = async () => {
    setDeleteError(null);

    try {
      await deleteReportEntries({ year, month }).unwrap();
      setImportSummary(null);
      setIsDeleteDialogOpen(false);
    } catch (err) {
      setDeleteError(typeof err === 'string' ? err : 'Не удалось удалить отчёт');
    }
  };

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

        {/* An import jumps the tab to the imported file's period, which can be
            months away from where the user started — this is the way back. */}
        {!isCurrentPeriod && (
          <Button
            view="flat"
            size="m"
            onClick={() =>
              dispatch(reportPeriodSet({ year: currentYear, month: currentMonth }))
            }
          >
            Текущий месяц
          </Button>
        )}
      </div>

      <Card view="outlined" className={styles.card}>
        <SectionHeader
          title="Отчёт"
          meta={entries.length > 0 ? String(entries.length) : undefined}
          actions={
            <>
              {/* The report can be replaced from another device or pushed in
                  by ntlstl.report, so what's on screen can go stale without
                  anything happening in this tab. */}
              <Button
                view="flat"
                size="m"
                loading={isFetching}
                onClick={() => void refetch()}
                aria-label="Обновить данные"
              >
                <Icon data={ArrowsRotateLeft} size={16} />
              </Button>
              <Button view="action" size="m" loading={isImporting} onClick={() => inputRef.current?.click()}>
                <Icon data={FileArrowUp} size={16} />
                Импортировать
              </Button>
              <Button
                view="flat-danger"
                size="m"
                disabled={entries.length === 0}
                onClick={() => setIsDeleteDialogOpen(true)}
                aria-label="Удалить отчёт"
              >
                <Icon data={TrashBin} size={16} />
              </Button>
            </>
          }
        />

        <input ref={inputRef} type="file" hidden accept=".xlsx" onChange={handleChange} />

        {importError && (
          <Alert theme="danger" view="filled" message={importError} onClose={() => setImportError(null)} />
        )}

        {importSummary && !importError && (
          <Alert theme="success" view="filled" message={importSummary} onClose={() => setImportSummary(null)} />
        )}

        {deleteError && (
          <Alert theme="danger" view="filled" message={deleteError} onClose={() => setDeleteError(null)} />
        )}

        {isError && !isLoading && (
          <Alert theme="danger" view="filled" message="Не удалось загрузить отчёт" />
        )}

        {isLoading && (
          <div className={styles.centered}>
            <Loader size="m" />
          </div>
        )}

        {!isLoading && entries.length === 0 && (
          <EmptyState
            icon={LayoutHeaderCells}
            title={`За ${MONTH_NAMES[month - 1]} ${year} нет данных`}
            description="Импортируйте xlsx-выгрузку из CRM — год и месяц определятся по названию файла."
          />
        )}

        {!isLoading && entries.length > 0 && (
          <div className={styles.reportTableWrap}>
            <table className={styles.reportTable}>
              <thead>
                <tr>
                  {COLUMNS.map((column) => {
                    const state = ariaSort(sort, column.key);
                    const icon =
                      state === 'ascending'
                        ? ArrowUp
                        : state === 'descending'
                          ? ArrowDown
                          : ArrowUpArrowDown;

                    return (
                      <th
                        key={column.key}
                        className={column.numeric ? styles.reportHoursCell : undefined}
                        aria-sort={state}
                      >
                        <button
                          type="button"
                          className={[
                            styles.sortButton,
                            column.numeric && styles.sortButtonNumeric,
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() => setSort(nextSort(sort, column.key))}
                        >
                          {column.title}
                          <Icon
                            data={icon}
                            size={12}
                            className={[
                              styles.sortIcon,
                              state === 'none' && styles.sortIconInactive,
                            ]
                              .filter(Boolean)
                              .join(' ')}
                          />
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.taskName}</td>
                    <td>{entry.status}</td>
                    <td className={styles.reportHoursCell}>{entry.hours}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>Итого</td>
                  <td className={styles.reportHoursCell}>{totalHours}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <Dialog open={isDeleteDialogOpen} onClose={() => setIsDeleteDialogOpen(false)}>
        <Dialog.Header caption="Удалить отчёт?" />
        <Dialog.Body>
          <Text color="secondary">
            Все задачи за {MONTH_NAMES[month - 1].toLowerCase()} {year} года будут удалены.
            Это действие нельзя отменить.
          </Text>
        </Dialog.Body>
        <Dialog.Footer
          preset="danger"
          loading={isDeleting}
          textButtonApply="Удалить"
          textButtonCancel="Отмена"
          onClickButtonCancel={() => setIsDeleteDialogOpen(false)}
          onClickButtonApply={() => void handleDelete()}
        />
      </Dialog>
    </div>
  );
}
