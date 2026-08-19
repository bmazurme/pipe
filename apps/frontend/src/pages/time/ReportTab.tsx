import { ChangeEvent, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileArrowUp, LayoutHeaderCells } from '@gravity-ui/icons';
import { Alert, Button, Card, Icon, Loader, Text } from '@gravity-ui/uikit';

import {
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

  const inputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<string | null>(null);

  const totalHours = entries.reduce((sum, entry) => sum + entry.hours, 0);

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

  return (
    <div className={styles.tabPanel}>
      <div className={styles.periodSwitcher}>
        <div className={styles.yearSwitcher}>
          <Button
            view="flat"
            size="m"
            onClick={() => dispatch(reportYearChanged(year - 1))}
            aria-label="Предыдущий год"
          >
            <Icon data={ChevronLeft} size={16} />
          </Button>
          <Text variant="subheader-1" className={styles.yearValue}>
            {year}
          </Text>
          <Button
            view="flat"
            size="m"
            onClick={() => dispatch(reportYearChanged(year + 1))}
            aria-label="Следующий год"
          >
            <Icon data={ChevronRight} size={16} />
          </Button>
        </div>

        <div className={styles.yearSwitcher}>
          <Button
            view="flat"
            size="m"
            onClick={() => dispatch(reportMonthStepped(-1))}
            aria-label="Предыдущий месяц"
          >
            <Icon data={ChevronLeft} size={16} />
          </Button>
          <Text variant="subheader-1" className={styles.monthValue}>
            {MONTH_NAMES[month - 1]}
          </Text>
          <Button
            view="flat"
            size="m"
            onClick={() => dispatch(reportMonthStepped(1))}
            aria-label="Следующий месяц"
          >
            <Icon data={ChevronRight} size={16} />
          </Button>
        </div>
      </div>

      <Card view="outlined" className={styles.card}>
        <SectionHeader
          title="Отчёт"
          meta={entries.length > 0 ? String(entries.length) : undefined}
          actions={
            <Button view="action" size="m" loading={isImporting} onClick={() => inputRef.current?.click()}>
              <Icon data={FileArrowUp} size={16} />
              Импортировать
            </Button>
          }
        />

        <input ref={inputRef} type="file" hidden accept=".xlsx" onChange={handleChange} />

        {importError && (
          <Alert theme="danger" view="filled" message={importError} onClose={() => setImportError(null)} />
        )}

        {importSummary && !importError && (
          <Alert theme="success" view="filled" message={importSummary} onClose={() => setImportSummary(null)} />
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
    </div>
  );
}
