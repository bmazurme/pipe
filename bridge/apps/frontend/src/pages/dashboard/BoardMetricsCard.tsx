import { useState } from 'react';
import { Thunderbolt } from '@gravity-ui/icons';
import { Card, Label, SegmentedRadioGroup, Skeleton, Text } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { type BoardMetricsStatus, type DashboardBoardMetrics, getErrorMessage, useGetDashboardBoardMetricsQuery } from '../../store/api';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../DashboardPage.module.css';
import { TempChart } from './TempChart';

const POLL_MS = 60_000;

const STATUS_THEME: Record<BoardMetricsStatus, 'success' | 'warning' | 'danger'> = { ok: 'success', warn: 'warning', bad: 'danger' };

const WINDOWS = [
  { value: '24', content: '24 часа' },
  { value: '168', content: '7 дней' },
];

function uptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);

  return days > 0 ? `${days} дн ${hours} ч` : `${hours} ч ${Math.floor((seconds % 3600) / 60)} мин`;
}

function BoardRow({ board, hours }: { board: DashboardBoardMetrics; hours: number }) {
  const { data } = board;
  const name = board.host.replace(/^ubuntu-/, '');
  const facts = [
    data.nvmeTempC !== undefined ? `NVMe ${data.nvmeTempC} °C` : null,
    data.fanRpm !== undefined ? `кулер ${data.fanRpm} об/мин` : null,
    data.load1 !== undefined ? `нагрузка ${data.load1}` : null,
    data.memAvailPct !== undefined ? `память свободна ${data.memAvailPct} %${data.memTotalMb ? ` из ${Math.round(data.memTotalMb / 1024)} ГБ` : ''}` : null,
    data.diskUsedPct !== undefined ? `диск ${data.diskUsedPct} %` : null,
    data.uptimeSec !== undefined ? `работает ${uptime(data.uptimeSec)}` : null,
  ].filter(Boolean);

  return (
    <div className={styles.nasBlock}>
      <div className={styles.row}>
        <Label theme={STATUS_THEME[board.status]}>{data.socTempC !== undefined && board.status !== 'bad' ? `${data.socTempC} °C` : board.status === 'bad' ? 'проблема' : '—'}</Label>
        <Text variant="body-2">{name}</Text>
        <Text color="secondary" variant="caption-2">
          {formatRelativeTime(board.at)}
        </Text>
      </div>
      {board.reasons.map((reason) => (
        <Text key={reason} variant="caption-2" color={board.status === 'bad' ? 'danger' : 'warning'}>
          {reason}
        </Text>
      ))}
      {facts.length > 0 && (
        <Text color="secondary" variant="caption-2">
          {facts.join(' · ')}
        </Text>
      )}
      <TempChart points={board.series} label={`Температура ${name} за ${hours === 24 ? '24 часа' : '7 дней'}`} />
    </div>
  );
}

// The vital signs of the boards - temperature (with its graph), throttling, fan, NVMe, load, memory, disk - from the readings the board agent sends
// every two minutes. A board that stopped sending shows as a problem: that is also the quickest sign of a dead or hung board.
export function BoardMetricsCard() {
  const [hours, setHours] = useState('24');
  const { data, isLoading, isError, error } = useGetDashboardBoardMetricsQuery(Number(hours), { pollingInterval: POLL_MS, skipPollingIfUnfocused: true });
  const boards = Array.isArray(data) ? data : [];

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader
        title="Платы: температура и питание"
        icon={Thunderbolt}
        actions={<SegmentedRadioGroup size="s" value={hours} onUpdate={setHours} options={WINDOWS} />}
      />
      {isLoading ? (
        <Skeleton className={styles.statusSkeleton} />
      ) : isError ? (
        <div className={styles.row}>
          <Label theme="danger">Не удалось загрузить</Label>
          <Text color="secondary" variant="caption-2">
            {getErrorMessage(error, 'Ошибка запроса')}
          </Text>
        </div>
      ) : boards.length === 0 ? (
        <Text color="secondary" variant="caption-2">
          Данных пока нет. Платы начнут присылать их после обновления агента (страница «Платы» → «Обновить» у новой версии board-agent.sh).
        </Text>
      ) : (
        boards.map((board) => <BoardRow key={board.host} board={board} hours={Number(hours)} />)
      )}
    </Card>
  );
}
