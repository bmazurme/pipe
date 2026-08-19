import { ChangeEvent, useRef, useState } from 'react';
import { FileArrowUp, LayoutHeaderCells, TrashBin } from '@gravity-ui/icons';
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
    isError,
  } = useListReportEntriesQuery({ year, month });
  const [importReport, { isLoading: isImporting }] = useImportReportMutation();
  const [deleteReportEntries, { isLoading: isDeleting }] = useDeleteReportEntriesMutation();

  const inputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
                  <th>Задача</th>
                  <th>Статус</th>
                  <th className={styles.reportHoursCell}>Часы</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
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
