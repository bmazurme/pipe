import { useMemo, useState } from 'react';
import { Button, Icon, Text, Tooltip, useToaster } from '@gravity-ui/uikit';
import { ArrowsRotateLeft, FileArrowDown, ListCheck, PaperPlane } from '@gravity-ui/icons';
import type { MonthKeyType } from '@reports/shared';

import { getColumns } from '../../constants';
import MyTable, { RowData } from '../../hocs/with-table-sorting';
import { reportSelector, settingsSelector } from '../../store';
import { useGetCountsQuery, useGetReportsQuery, usePushReportToBridgeMutation } from '../../store/api';
import { useAppSelector } from '../../hooks';
import { useMediaQuery } from '../../hooks/use-media-query';
import { exportReport } from '../../utils/export-report';
import { describeError } from '../../utils/describe-error';
import { EmptyState } from '../state';

import reportStyle from './report.module.css';

const hoursFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

function Report({ report, offDays }: { report: RowData[]; offDays: number }) {
  const toaster = useToaster();
  const { month, year } = useAppSelector(reportSelector);
  const { employee, company } = useAppSelector(settingsSelector);
  const { refetch: refetchCounts, isFetching: isCountsFetching } = useGetCountsQuery(year);
  const { refetch: refetchReports, isFetching: isReportsFetching } = useGetReportsQuery();
  const [pushReportToBridge, { isLoading: isPushing }] = usePushReportToBridgeMutation();
  const [isExporting, setIsExporting] = useState(false);
  const isMobile = useMediaQuery('(max-width: 640px)');
  const columns = useMemo(() => getColumns(isMobile), [isMobile]);

  const isRefreshing = isCountsFetching || isReportsFetching;
  const trackedRows = report.filter((item) => item.time > 0);
  const trackedHours = trackedRows.reduce((sum, item) => sum + item.time, 0);
  const entriesToSend = trackedRows.map((item) => ({ taskName: item.name, status: item.status, hours: item.time }));

  const handleExport = async () => {
    setIsExporting(true);

    try {
      await exportReport({
        report,
        month: month as MonthKeyType,
        year,
        employee,
        company,
        offDays,
      });
      toaster.add({
        name: 'export-success',
        theme: 'success',
        title: 'Файл выгружен',
        content: 'Excel-отчёт сохранён в загрузки',
        autoHiding: 4000,
      });
    } catch (error) {
      toaster.add({
        name: 'export-error',
        theme: 'danger',
        title: 'Не удалось выгрузить файл',
        content: describeError(error),
        isClosable: true,
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleRefresh = () => {
    refetchCounts();
    refetchReports();
  };

  const handlePush = async () => {
    try {
      await pushReportToBridge({
        year: Number(year),
        month: Number(month),
        entries: entriesToSend,
      }).unwrap();

      toaster.add({
        name: 'push-success',
        theme: 'success',
        title: 'Отчёт отправлен',
        content: `Передано задач: ${entriesToSend.length}`,
        autoHiding: 4000,
      });
    } catch (error) {
      toaster.add({
        name: 'push-error',
        theme: 'danger',
        title: 'Не удалось отправить отчёт',
        content: describeError(error, 'Проверьте Bridge API в настройках'),
        isClosable: true,
      });
    }
  };

  return (
    <section className={reportStyle.report} aria-label="Задачи за месяц">
      <div className={reportStyle.header}>
        <div className={reportStyle.titleBox}>
          <Text variant="header-1">Задачи</Text>
          <Text variant="body-1" color="secondary">
            {report.length === 0
              ? 'Нет данных'
              : `${report.length} шт. · ${hoursFormatter.format(trackedHours)} ч списано`}
          </Text>
        </div>
        <div className={reportStyle.actions}>
          <Button view="outlined" size="m" onClick={handleRefresh} loading={isRefreshing}>
            <Icon data={ArrowsRotateLeft} size={16} />
            Обновить
          </Button>
          <Button
            view="outlined"
            size="m"
            onClick={handleExport}
            loading={isExporting}
            disabled={trackedRows.length === 0}
          >
            <Icon data={FileArrowDown} size={16} />
            Excel
          </Button>
          <Tooltip
            content={entriesToSend.length === 0 ? 'Нет задач с затраченным временем' : 'Отправить отчёт в bridge'}
          >
            <Button
              view="action"
              size="m"
              onClick={handlePush}
              loading={isPushing}
              disabled={entriesToSend.length === 0}
            >
              <Icon data={PaperPlane} size={16} />
              Отправить
            </Button>
          </Tooltip>
        </div>
      </div>
      {report.length === 0 ? (
        <EmptyState
          icon={<Icon data={ListCheck} size={28} />}
          title="Задач за период нет"
          description="Проверьте настройки GitLab или обновите данные."
          action={(
            <Button view="outlined" size="m" onClick={handleRefresh} loading={isRefreshing}>
              <Icon data={ArrowsRotateLeft} size={16} />
              Обновить
            </Button>
          )}
        />
      ) : (
        <div className={reportStyle.card}>
          <MyTable
            data={report}
            columns={columns}
            width="max"
            verticalAlign="middle"
            wordWrap
            edgePadding
          />
          <div className={reportStyle.summary}>
            <Text variant="body-2" color="secondary">Итого</Text>
            <Text variant="subheader-1" className={reportStyle.summaryValue}>
              {hoursFormatter.format(trackedHours)} ч
            </Text>
          </div>
        </div>
      )}
    </section>
  )
}

export default Report;
