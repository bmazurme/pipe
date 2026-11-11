import { PlugConnection } from '@gravity-ui/icons';
import { Card, Label, Skeleton, Text } from '@gravity-ui/uikit';

import { formatDateTime, formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { type ChannelCell, type ChannelState, type ChannelsStatus, type DashboardChannel, getErrorMessage, type ProbeResult, useGetDashboardChannelsQuery } from '../../store/api';
import { SectionHeader } from '../../widgets/SectionHeader';
import dashboardStyles from '../DashboardPage.module.css';
import styles from './ChannelsCard.module.css';

const POLL_MS = 60_000;

const STATUS_THEME: Record<ChannelsStatus, 'success' | 'warning' | 'danger'> = { ok: 'success', warn: 'warning', bad: 'danger' };
const STATUS_LABEL: Record<ChannelsStatus, string> = { ok: 'в порядке', warn: 'есть замечания', bad: 'проблема' };

const STATE_THEME: Record<ChannelState, 'success' | 'warning' | 'danger' | 'unknown'> = { ok: 'success', partial: 'warning', down: 'danger', unknown: 'unknown' };
const STATE_LABEL: Record<ChannelState, string> = { ok: 'доступен', partial: 'не отовсюду', down: 'недоступен', unknown: 'нет проб' };

// How far a connection got, in a word a cell can hold; the long wording is the cell's title.
const RESULT_SHORT: Record<Exclude<ProbeResult, 'ok'>, string> = {
  tcp_timeout: 'нет SYN-ACK',
  tcp_refused: 'RST',
  tls_timeout: 'тишина',
  tls_reset: 'сброс',
  tls_error: 'TLS ✗',
  error: 'ошибка',
};

const RESULT_TEXT: Record<ProbeResult, string> = {
  ok: 'доступен',
  tcp_timeout: 'нет ответа на SYN (порт или адрес отфильтрован)',
  tcp_refused: 'порт закрыт (RST на SYN)',
  tls_timeout: 'соединение есть, дальше тишина (тротлинг?)',
  tls_reset: 'сброс после рукопожатия (DPI?)',
  tls_error: 'ошибка TLS',
  error: 'ошибка соединения',
};

// The same results mean something else for a request through a tunnel than for a connection to a server.
const E2E_SHORT: Record<Exclude<ProbeResult, 'ok'>, string> = {
  tcp_timeout: 'нет ответа',
  tcp_refused: 'туннель ✗',
  tls_timeout: 'завис',
  tls_reset: 'сброс',
  tls_error: 'TLS ✗',
  error: 'ошибка',
};

const E2E_TEXT: Record<ProbeResult, string> = {
  ok: 'запрос через туннель проходит',
  tcp_timeout: 'нет ответа',
  tcp_refused: 'туннель не принимает соединения (он не поднят?)',
  tls_timeout: 'запрос завис (тротлинг?)',
  tls_reset: 'соединение сброшено',
  tls_error: 'ошибка TLS',
  error: 'ошибка запроса (например, 403 — выход не годится для этого сервиса)',
};

function Cell({ cell, e2e = false }: { cell: ChannelCell | undefined; e2e?: boolean }) {
  if (!cell) {
    return (
      <Text color="secondary" variant="caption-2">
        —
      </Text>
    );
  }

  const ms = cell.tcpMs !== null || cell.tlsMs !== null ? (cell.tcpMs ?? 0) + (cell.tlsMs ?? 0) : null;
  const title = [
    (e2e ? E2E_TEXT : RESULT_TEXT)[cell.result],
    cell.detail ? `(${cell.detail})` : null,
    `проверено ${formatDateTime(cell.probedAt)}`,
    `результат держится с ${formatDateTime(cell.changedAt)}`,
    cell.stale ? 'проба устарела' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  if (cell.stale) {
    return (
      <Label size="s" theme="unknown" title={title}>
        устарело
      </Label>
    );
  }

  return (
    <Label size="s" theme={cell.result === 'ok' ? 'success' : 'danger'} title={title}>
      {cell.result === 'ok' ? `${ms ?? ''} мс` : e2e && cell.result === 'error' && cell.detail ? cell.detail : (e2e ? E2E_SHORT : RESULT_SHORT)[cell.result]}
    </Label>
  );
}

function Matrix({ channels, vantages, e2e = false, label = 'Канал' }: { channels: DashboardChannel[]; vantages: string[]; e2e?: boolean; label?: string }) {
  return (
    <div className={styles.scroll}>
      <table className={styles.matrix}>
        <thead>
          <tr>
            <th scope="col">
              <Text color="secondary" variant="caption-2">
                {label}
              </Text>
            </th>
            {vantages.map((vantage) => (
              <th key={vantage} scope="col">
                <Text color="secondary" variant="caption-2">
                  {vantage}
                </Text>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {channels.map((channel) => (
            <tr key={channel.key}>
              <th scope="row">
                <div className={styles.channelName}>
                  <span className={styles.head}>
                    <Text variant="body-2">{channel.name}</Text>
                    <Label size="xs" theme={STATE_THEME[channel.state]}>
                      {STATE_LABEL[channel.state]}
                    </Label>
                  </span>
                  <Text color="secondary" variant="caption-2">
                    {e2e ? channel.host : `${channel.key} · SNI ${channel.sni}`}
                  </Text>
                </div>
              </th>
              {vantages.map((vantage) => (
                <td key={vantage}>
                  <Cell cell={channel.cells.find((cell) => cell.vantage === vantage)} e2e={e2e} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The VPN channels as probed from several places (bridge itself, and every agent running infra/linkprobe): a blocked server shows
// as red from the networks that cannot reach it and green from the rest, so the blocking is seen, not guessed.
export function ChannelsCard() {
  const { data, isLoading, isError, error } = useGetDashboardChannelsQuery(undefined, { pollingInterval: POLL_MS, skipPollingIfUnfocused: true });
  const channels = data && Array.isArray(data.channels) ? data.channels : [];

  return (
    <Card view="outlined" className={dashboardStyles.card}>
      <SectionHeader title="Каналы связи" icon={PlugConnection} />
      {isLoading ? (
        <Skeleton className={dashboardStyles.statusSkeleton} />
      ) : isError || !data ? (
        <div className={dashboardStyles.row}>
          <Label theme="danger">Не удалось загрузить</Label>
          <Text color="secondary" variant="caption-2">
            {getErrorMessage(error, 'Ошибка запроса')}
          </Text>
        </div>
      ) : channels.length === 0 ? (
        <Text color="secondary" variant="caption-2">
          Каналов ещё нет: они появляются из ссылок подключений на странице VPN.
        </Text>
      ) : (
        <div className={styles.block}>
          <div className={styles.head}>
            <Label theme={STATUS_THEME[data.status]} size="m">
              {STATUS_LABEL[data.status]}
            </Label>
            <Text color="secondary" variant="caption-2">
              живых каналов: {channels.filter((channel) => channel.state === 'ok' || channel.state === 'partial').length} из {channels.length}
            </Text>
          </div>

          {data.reasons.length > 0 && (
            <div className={styles.reasons}>
              {data.reasons.map((reason) => (
                <Text key={reason} variant="caption-2" color={data.status === 'bad' ? 'danger' : 'warning'}>
                  {reason}
                </Text>
              ))}
            </div>
          )}

          <Matrix channels={channels} vantages={data.vantages.map((vantage) => vantage.name)} />

          <div className={styles.vantages}>
            {data.vantages.map((vantage) => (
              <Text key={vantage.name} color={vantage.stale ? 'warning' : 'secondary'} variant="caption-2">
                {vantage.name}: проба {formatRelativeTime(vantage.lastProbeAt)}
              </Text>
            ))}
          </div>

          {(data.e2e ?? []).length > 0 && (
            <>
              <Text variant="subheader-1">Сквозная проверка через туннель</Text>
              <Text color="secondary" variant="caption-2">
                Запрос, который воркер делает через свой туннель: доходит ли он до сервиса, а не только до VPN-сервера. Claude API, недоступный ни у одного воркера, —
                проблема: задачи не выполняются.
              </Text>
              <Matrix channels={data.e2e ?? []} vantages={(data.e2eVantages ?? []).map((vantage) => vantage.name)} e2e label="Сервис" />
            </>
          )}
        </div>
      )}
    </Card>
  );
}
