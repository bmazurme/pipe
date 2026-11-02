import { Thunderbolt } from '@gravity-ui/icons';
import { Card, Label, Progress, Skeleton, Text } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { type DashboardUps, getErrorMessage, type UpsStatus, useGetDashboardUpsQuery } from '../../store/api';
import { SectionHeader } from '../../widgets/SectionHeader';
import dashboardStyles from '../DashboardPage.module.css';
import styles from './UpsCard.module.css';

const POLL_MS = 60_000;

const STATUS_THEME: Record<UpsStatus, 'success' | 'warning' | 'danger'> = {
  ok: 'success',
  warn: 'warning',
  bad: 'danger',
};

const STATUS_LABEL: Record<UpsStatus, string> = {
  ok: 'в порядке',
  warn: 'есть замечания',
  bad: 'проблема',
};

// NUT's ups.status flags in words; the ones nobody needs to read are left out.
const FLAG_LABEL: Record<string, string> = {
  OL: 'от сети',
  OB: 'от батареи',
  CHRG: 'заряжается',
  DISCHRG: 'разряжается',
  LB: 'батарея разряжена',
  RB: 'заменить батарею',
  FSD: 'выключение плат',
  OVER: 'перегрузка',
  BYPASS: 'обход',
};

const flagsOf = (status: string) => status.trim().split(/\s+/).filter((flag) => flag in FLAG_LABEL);

function duration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);

  return hours > 0 ? `${hours} ч ${minutes} мин` : `${minutes} мин`;
}

function UpsRow({ ups }: { ups: DashboardUps }) {
  const { data } = ups;
  const flags = flagsOf(data.status);

  return (
    <div className={styles.block}>
      <div className={styles.head}>
        <Label theme={STATUS_THEME[ups.status]} size="m">
          {STATUS_LABEL[ups.status]}
        </Label>
        <Text variant="subheader-2">{data.model ?? 'ИБП'}</Text>
        <Text color="secondary" variant="caption-2">
          подключён к {ups.host} · отчёт {formatRelativeTime(ups.reportedAt)}
        </Text>
      </div>

      {ups.reasons.length > 0 && (
        <div className={styles.reasons}>
          {ups.reasons.map((reason) => (
            <Text key={reason} variant="caption-2" color={ups.status === 'bad' ? 'danger' : 'warning'}>
              {reason}
            </Text>
          ))}
        </div>
      )}

      <dl className={styles.facts}>
        <Text as="dt" color="secondary" variant="body-1">
          Состояние
        </Text>
        <dd>
          {flags.map((flag) => (
            <Label key={flag} size="s" theme={flag === 'OL' || flag === 'CHRG' ? 'success' : flag === 'OB' || flag === 'LB' ? 'danger' : 'warning'}>
              {FLAG_LABEL[flag]}
            </Label>
          ))}
        </dd>

        {data.chargePct != null && (
          <>
            <Text as="dt" color="secondary" variant="body-1">
              Заряд
            </Text>
            <dd>
              <div className={styles.meter}>
                <div role="progressbar" aria-label="Заряд батареи" aria-valuemin={0} aria-valuemax={100} aria-valuenow={data.chargePct}>
                  <Progress value={data.chargePct} size="s" theme={data.chargePct < 50 ? 'warning' : 'default'} />
                </div>
                <Text color="secondary" variant="caption-2">
                  {data.chargePct} %
                  {data.runtimeSec != null ? ` · хватит примерно на ${duration(data.runtimeSec)}` : ''}
                </Text>
              </div>
            </dd>
          </>
        )}

        {data.loadPct != null && (
          <>
            <Text as="dt" color="secondary" variant="body-1">
              Нагрузка
            </Text>
            <dd>
              <div className={styles.meter}>
                <div role="progressbar" aria-label="Нагрузка" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(data.loadPct, 100)}>
                  <Progress value={Math.min(data.loadPct, 100)} size="s" theme={data.loadPct >= 80 ? 'warning' : 'default'} />
                </div>
                <Text color="secondary" variant="caption-2">
                  {data.loadPct} %
                  {data.nominalWatts != null ? ` · около ${Math.round((data.loadPct / 100) * data.nominalWatts)} Вт из ${data.nominalWatts}` : ''}
                </Text>
              </div>
            </dd>
          </>
        )}

        {data.inputVolts != null && (
          <>
            <Text as="dt" color="secondary" variant="body-1">
              Вход
            </Text>
            <dd>
              <Text variant="body-2">{Math.round(data.inputVolts)} В</Text>
            </dd>
          </>
        )}

        {data.testResult && (
          <>
            <Text as="dt" color="secondary" variant="body-1">
              Тест батареи
            </Text>
            <dd>
              <Text variant="body-2">{data.testResult}</Text>
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

// The UPS the boards stand on. The board its USB cable is in reports it (infra/ups), so "no report" means NUT or the cable is not set up, not "fine".
export function UpsCard() {
  const { data, isLoading, isError, error } = useGetDashboardUpsQuery(undefined, { pollingInterval: POLL_MS, skipPollingIfUnfocused: true });
  const list = Array.isArray(data) ? data : [];

  return (
    <Card view="outlined" className={dashboardStyles.card}>
      <SectionHeader title="ИБП" icon={Thunderbolt} />
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
          ИБП ещё не присылал данных. Их присылает плата, к которой подключён его USB-кабель (infra/ups: install.sh).
        </Text>
      ) : (
        list.map((ups) => <UpsRow key={ups.host} ups={ups} />)
      )}
    </Card>
  );
}
