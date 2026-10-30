import { useState } from 'react';
import { Thunderbolt } from '@gravity-ui/icons';
import { Card, Label, SegmentedRadioGroup, Skeleton, Text } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { type BoardMetricsStatus, type DashboardBoardMetrics, getErrorMessage, useGetDashboardBoardMetricsQuery } from '../../store/api';
import { SectionHeader } from '../../widgets/SectionHeader';
import dashboardStyles from '../DashboardPage.module.css';
import styles from './BoardMetricsCard.module.css';
import { TempChart } from './TempChart';
import { fanText } from './tempSeries';

const POLL_MS = 60_000;

const STATUS_THEME: Record<BoardMetricsStatus, 'success' | 'warning' | 'danger'> = { ok: 'success', warn: 'warning', bad: 'danger' };

const WINDOWS = [
  { value: '24', content: '24 часа' },
  { value: '168', content: '7 дней' },
];

type ChipTheme = 'normal' | 'warning' | 'danger';

interface Chip {
  key: string;
  text: string;
  theme: ChipTheme;
  hint?: string;
}

function uptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);

  return days > 0 ? `${days} дн ${hours} ч` : `${hours} ч ${Math.floor((seconds % 3600) / 60)} мин`;
}

// The same limits the verdict uses (src/boards/board-metrics.ts), so a chip turns yellow or red exactly when the board does.
function chipsFor(data: DashboardBoardMetrics['data']): Chip[] {
  const chips: Chip[] = [];

  if (data.nvmeTempC !== undefined) {
    chips.push({ key: 'nvme', text: `NVMe ${data.nvmeTempC} °C`, theme: data.nvmeTempC >= 80 ? 'danger' : data.nvmeTempC >= 70 ? 'warning' : 'normal' });
  }
  if (data.fanRpm !== undefined) {
    const fan = fanText(data.fanRpm, data.socTempC);

    chips.push({ key: 'fan', text: fan.text, theme: fan.warn ? 'warning' : 'normal', hint: data.fanRpm === 0 && !fan.warn ? 'Штатный кулер включается, когда процессор тёплый (около 50 °C)' : undefined });
  }
  if (data.load1 !== undefined) chips.push({ key: 'load', text: `нагрузка ${data.load1}`, theme: 'normal', hint: 'Средняя за последнюю минуту; у платы 4 ядра' });
  if (data.memAvailPct !== undefined) {
    chips.push({
      key: 'mem',
      text: `память свободна ${data.memAvailPct} %`,
      theme: data.memAvailPct < 10 ? 'danger' : data.memAvailPct < 15 ? 'warning' : 'normal',
      hint: data.memTotalMb ? `Всего ${Math.round(data.memTotalMb / 1024)} ГБ` : undefined,
    });
  }
  if (data.diskUsedPct !== undefined) {
    chips.push({ key: 'disk', text: `диск ${data.diskUsedPct} %`, theme: data.diskUsedPct >= 90 ? 'danger' : data.diskUsedPct >= 80 ? 'warning' : 'normal' });
  }

  return chips;
}

function BoardRow({ board, hours }: { board: DashboardBoardMetrics; hours: number }) {
  const { data } = board;
  const name = board.host.replace(/^ubuntu-/, '');
  const windowText = hours === 24 ? '24 часа назад' : '7 дней назад';
  const headline = board.status === 'bad' ? 'проблема' : data.socTempC !== undefined ? `${data.socTempC} °C` : '—';

  return (
    <div className={styles.board}>
      <div className={styles.who}>
        <div className={styles.whoLine}>
          <Label theme={STATUS_THEME[board.status]} size="m">
            {headline}
          </Label>
          <Text variant="subheader-2">{name}</Text>
        </div>
        <Text color="secondary" variant="caption-2">
          {formatRelativeTime(board.at)}
          {data.uptimeSec !== undefined ? ` · работает ${uptime(data.uptimeSec)}` : ''}
        </Text>
      </div>

      <TempChart points={board.series} label={`Температура ${name} за ${hours === 24 ? '24 часа' : '7 дней'}`} windowText={windowText} />

      <div className={styles.chips}>
        {chipsFor(data).map((chip) => (
          <Label key={chip.key} size="s" theme={chip.theme === 'normal' ? 'unknown' : chip.theme} title={chip.hint}>
            {chip.text}
          </Label>
        ))}
      </div>

      {board.reasons.length > 0 && (
        <div className={styles.reasons}>
          {board.reasons.map((reason) => (
            <Text key={reason} variant="caption-2" color={board.status === 'bad' ? 'danger' : 'warning'}>
              {reason}
            </Text>
          ))}
        </div>
      )}
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
    <Card view="outlined" className={dashboardStyles.card}>
      <SectionHeader
        title="Платы: температура и питание"
        icon={Thunderbolt}
        meta={boards.length ? `${boards.filter((board) => board.status === 'ok').length} из ${boards.length} в порядке` : undefined}
        actions={<SegmentedRadioGroup size="s" value={hours} onUpdate={setHours} options={WINDOWS} />}
      />
      {boards.length > 0 && (
        <div className={styles.legend}>
          <Text variant="caption-2" color="secondary">
            <span className={styles.swatch} />
            процессор
          </Text>
          <Text variant="caption-2" color="secondary">
            <span className={`${styles.swatch} ${styles.swatchDashed}`} />
            NVMe
          </Text>
          <Text variant="caption-2" color="secondary">
            Точечные линии — 65 и 75 °C, появляются, когда температура рядом с ними
          </Text>
        </div>
      )}
      {isLoading ? (
        <Skeleton className={dashboardStyles.statusSkeleton} />
      ) : isError ? (
        <div className={dashboardStyles.row}>
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
        <div>
          {boards.map((board) => (
            <BoardRow key={board.host} board={board} hours={Number(hours)} />
          ))}
        </div>
      )}
    </Card>
  );
}
