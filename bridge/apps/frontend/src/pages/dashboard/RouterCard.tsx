import { Globe } from '@gravity-ui/icons';
import { Card, Label, Text, Skeleton } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { type DashboardRouter, getErrorMessage, type RouterStatus, useGetDashboardRouterQuery } from '../../store/api';
import { SectionHeader } from '../../widgets/SectionHeader';
import dashboardStyles from '../DashboardPage.module.css';
import styles from './RouterCard.module.css';

const POLL_MS = 60_000;

const STATUS_THEME: Record<RouterStatus, 'success' | 'warning' | 'danger'> = {
  ok: 'success',
  warn: 'warning',
  bad: 'danger',
};

const STATUS_LABEL: Record<RouterStatus, string> = {
  ok: 'в порядке',
  warn: 'есть замечания',
  bad: 'проблема',
};

const REBOOT_LABEL: Record<NonNullable<DashboardRouter['reboot']>['status'], string> = {
  pending: 'запрошена, плата ещё не забрала',
  taken: 'выполняется',
  done: 'выполнена',
  failed: 'не удалась',
  expired: 'не выполнена (запрос устарел)',
};

function uptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);

  return days > 0 ? `${days} дн ${hours} ч` : `${hours} ч ${Math.floor((seconds % 3600) / 60)} мин`;
}

// 1 234 567 bit/s → "1,2 Мбит/с"
function speed(bps: number): string {
  if (bps >= 1_000_000) return `${(Math.round(bps / 100_000) / 10).toString().replace('.', ',')} Мбит/с`;
  if (bps >= 1_000) return `${Math.round(bps / 1_000)} кбит/с`;

  return `${Math.round(bps)} бит/с`;
}

function RouterRow({ router }: { router: DashboardRouter }) {
  const { data } = router;
  const wan = data.wanAux === 1 ? 'кабель не подключён' : data.wanState === 2 ? 'подключён' : data.wanState != null ? `не подключён (${data.wanState})` : null;

  return (
    <div className={styles.block}>
      <div className={styles.head}>
        <Label theme={STATUS_THEME[router.status]} size="m">
          {STATUS_LABEL[router.status]}
        </Label>
        <Text variant="subheader-2">{data.model ?? router.host}</Text>
        <Text color="secondary" variant="caption-2">
          отчёт {formatRelativeTime(router.reportedAt)}
        </Text>
      </div>

      {router.reasons.length > 0 && (
        <div className={styles.reasons}>
          {router.reasons.map((reason) => (
            <Text key={reason} variant="caption-2" color={router.status === 'bad' ? 'danger' : 'warning'}>
              {reason}
            </Text>
          ))}
        </div>
      )}

      <dl className={styles.facts}>
        {wan && (
          <>
            <Text as="dt" color="secondary" variant="body-1">
              WAN
            </Text>
            <dd>
              <Label size="s" theme={data.wanAux === 1 || data.wanState !== 2 ? 'danger' : 'success'}>
                {wan}
              </Label>
              {data.internetOk != null && (
                <Label size="s" theme={data.internetOk ? 'success' : 'danger'}>
                  {data.internetOk ? 'интернет есть' : 'интернета нет'}
                </Label>
              )}
              {data.wanIp && <Text variant="body-2">{data.wanIp}</Text>}
            </dd>
          </>
        )}

        {data.pingMs != null && (
          <>
            <Text as="dt" color="secondary" variant="body-1">
              Пинг
            </Text>
            <dd>
              <Text variant="body-2">{Math.round(data.pingMs)} мс</Text>
              {(data.pingLossPct ?? 0) > 0 && (
                <Label size="s" theme={(data.pingLossPct ?? 0) >= 50 ? 'danger' : 'warning'}>
                  потери {data.pingLossPct} %
                </Label>
              )}
            </dd>
          </>
        )}

        {data.rxBps != null && data.txBps != null && (
          <>
            <Text as="dt" color="secondary" variant="body-1">
              Трафик
            </Text>
            <dd>
              <Text variant="body-2">↓ {speed(data.rxBps)}</Text>
              <Text variant="body-2">↑ {speed(data.txBps)}</Text>
            </dd>
          </>
        )}

        {data.uptimeSec != null && (
          <>
            <Text as="dt" color="secondary" variant="body-1">
              Работает
            </Text>
            <dd>
              <Text variant="body-2">{uptime(data.uptimeSec)}</Text>
            </dd>
          </>
        )}

        {router.reboot && (
          <>
            <Text as="dt" color="secondary" variant="body-1">
              Перезагрузка
            </Text>
            <dd>
              <Text variant="body-2">
                {REBOOT_LABEL[router.reboot.status]} · {formatRelativeTime(router.reboot.at)}
              </Text>
              {router.reboot.result && (
                <Text color="secondary" variant="caption-2">
                  {router.reboot.result}
                </Text>
              )}
            </dd>
          </>
        )}
      </dl>

      <Text color="secondary" variant="caption-2">
        Перезагрузить роутер можно командой /router в Telegram.
      </Text>
    </div>
  );
}

// The router the home link goes through. An agent on a board reads it over SSH (infra/router), so "no report" means the agent or the key is not
// set up, not "fine". Read-only: the reboot is a Telegram button, asked twice.
export function RouterCard() {
  const { data, isLoading, isError, error } = useGetDashboardRouterQuery(undefined, { pollingInterval: POLL_MS, skipPollingIfUnfocused: true });
  const list = Array.isArray(data) ? data : [];

  return (
    <Card view="outlined" className={dashboardStyles.card}>
      <SectionHeader title="Роутер" icon={Globe} />
      {isLoading ? (
        <Skeleton className={dashboardStyles.statusSkeleton} />
      ) : isError ? (
        <div className={dashboardStyles.row}>
          <Label theme="danger">Не удалось загрузить</Label>
          <Text color="secondary" variant="caption-2">
            {getErrorMessage(error, 'Ошибка запроса')}
          </Text>
        </div>
      ) : list.length === 0 ? (
        <Text color="secondary" variant="caption-2">
          Роутер ещё не отчитывался. Данные присылает агент на плате (infra/router: install.sh), когда ему выдан ключ SSH на роутере.
        </Text>
      ) : (
        list.map((router) => <RouterRow key={router.host} router={router} />)
      )}
    </Card>
  );
}
