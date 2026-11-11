import { Fragment } from 'react';
import { Cloud } from '@gravity-ui/icons';
import { Card, Label, Progress, Skeleton, Text } from '@gravity-ui/uikit';

import { formatBytes } from '../../shared/lib/formatBytes';
import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { type CloudService, type CloudStatus, type DashboardCloud, getErrorMessage, useGetDashboardCloudQuery } from '../../store/api';
import { SectionHeader } from '../../widgets/SectionHeader';
import dashboardStyles from '../DashboardPage.module.css';
import styles from './CloudCard.module.css';

const POLL_MS = 60_000;

const STATUS_THEME: Record<CloudStatus, 'success' | 'warning' | 'danger'> = {
  ok: 'success',
  warn: 'warning',
  bad: 'danger',
};

const STATUS_LABEL: Record<CloudStatus, string> = {
  ok: 'в порядке',
  warn: 'есть замечания',
  bad: 'проблема',
};

function uptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);

  return days > 0 ? `${days} дн ${hours} ч` : `${hours} ч ${Math.floor((seconds % 3600) / 60)} мин`;
}

const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : null);

function Meter({ label, value, theme, caption }: { label: string; value: number; theme: 'default' | 'warning' | 'danger'; caption: string }) {
  return (
    <div className={styles.meter}>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
        <Progress value={value} size="s" theme={theme} />
      </div>
      <Text color="secondary" variant="caption-2">
        {caption}
      </Text>
    </div>
  );
}

function serviceTheme(service: CloudService): 'success' | 'warning' | 'danger' | 'unknown' {
  if (service.desired === 0) return 'unknown';
  if (service.running < service.desired || service.health === 'unhealthy') return service.critical ? 'danger' : 'warning';

  return 'success';
}

// Up to this many healthy services are simply listed; more fold into a <details>.
const FOLD_FROM = 2;

const isFine = (service: CloudService) => serviceTheme(service) === 'success' && (service.restarts24h ?? 0) === 0;

function ServiceRow({ service }: { service: CloudService }) {
  return (
    <>
      <Text as="dt" variant="body-2">
        {service.name}
      </Text>
      <dd>
        <Label size="s" theme={serviceTheme(service)}>
          {service.desired === 0 ? 'выключен' : `${service.running} из ${service.desired}`}
        </Label>
        {service.health === 'unhealthy' && (
          <Label size="s" theme="danger">
            health не проходит
          </Label>
        )}
        {(service.restarts24h ?? 0) > 0 && (
          <Label size="s" theme="warning">
            перезапусков за сутки: {service.restarts24h}
          </Label>
        )}
        {service.memMb != null && (
          <Text color="secondary" variant="caption-2">
            {service.memMb} МБ
          </Text>
        )}
        {!service.critical && (
          <Text color="secondary" variant="caption-2">
            не критичный
          </Text>
        )}
      </dd>
    </>
  );
}

function CloudRow({ cloud }: { cloud: DashboardCloud }) {
  const { data } = cloud;
  const memUsedPct = pct(data.memory.totalMb - data.memory.availableMb, data.memory.totalMb);
  const memFreePct = pct(data.memory.availableMb, data.memory.totalMb);
  const swapPct = pct(data.memory.swapUsedMb, data.memory.swapTotalMb);
  const diskPct = pct(data.disk.usedBytes, data.disk.totalBytes);
  const backups = data.backups ?? [];
  const certs = data.certs ?? [];
  const problemServices = data.services.filter((service) => !isFine(service));
  const fineServices = data.services.filter(isFine);

  return (
    <div className={styles.block}>
      <div className={styles.head}>
        <Label theme={STATUS_THEME[cloud.status]} size="m">
          {STATUS_LABEL[cloud.status]}
        </Label>
        <Text variant="subheader-2">{cloud.host}</Text>
        {data.leader && (
          <Label size="s" theme={data.leader.site === 'vm' ? 'info' : 'warning'}>
            лидер: {data.leader.site} · эпоха {data.leader.epoch}
          </Label>
        )}
        {data.version && (
          <Text color="secondary" variant="caption-2">
            версия {data.version.slice(0, 8)}
          </Text>
        )}
        <Text color="secondary" variant="caption-2">
          отчёт {formatRelativeTime(cloud.reportedAt)} · работает {uptime(data.uptimeSec)}
        </Text>
      </div>

      {cloud.reasons.length > 0 && (
        <div className={styles.reasons}>
          {cloud.reasons.map((reason) => (
            <Text key={reason} variant="caption-2" color={cloud.status === 'bad' ? 'danger' : 'warning'}>
              {reason}
            </Text>
          ))}
        </div>
      )}

      <dl className={styles.facts}>
        {memUsedPct !== null && memFreePct !== null && (
          <>
            <Text as="dt" color="secondary" variant="body-1">
              Память
            </Text>
            <dd>
              <Meter
                label="Занятая память"
                value={memUsedPct}
                theme={memFreePct < 15 ? 'danger' : memFreePct < 25 ? 'warning' : 'default'}
                caption={`доступно ${data.memory.availableMb} МБ из ${data.memory.totalMb} МБ`}
              />
            </dd>
          </>
        )}

        <Text as="dt" color="secondary" variant="body-1">
          Swap
        </Text>
        <dd>
          {swapPct === null ? (
            <Label size="s" theme="warning">
              не настроен
            </Label>
          ) : (
            <Meter label="Занятый swap" value={swapPct} theme={swapPct > 50 ? 'warning' : 'default'} caption={`занято ${data.memory.swapUsedMb} МБ из ${data.memory.swapTotalMb} МБ`} />
          )}
        </dd>

        {diskPct !== null && (
          <>
            <Text as="dt" color="secondary" variant="body-1">
              Диск
            </Text>
            <dd>
              <Meter
                label="Заполнение диска"
                value={diskPct}
                theme={diskPct >= 90 ? 'danger' : diskPct >= 80 ? 'warning' : 'default'}
                caption={`занят на ${diskPct} % · ${formatBytes(data.disk.usedBytes)} из ${formatBytes(data.disk.totalBytes)}`}
              />
            </dd>
          </>
        )}

        {data.load5 !== null && (
          <>
            <Text as="dt" color="secondary" variant="body-1">
              Нагрузка
            </Text>
            <dd>
              <Text variant="body-2">
                {data.load5.toFixed(2)} за 5 мин на {data.cpus} ядр.
              </Text>
            </dd>
          </>
        )}

        {data.replication && (
          <>
            <Text as="dt" color="secondary" variant="body-1">
              Реплика на Pi
            </Text>
            <dd>
              {data.replication.connected ? (
                <Label size="s" theme={(data.replication.lagSec ?? 0) >= 60 ? 'warning' : 'success'}>
                  {data.replication.lagSec == null ? 'подключена' : `отстаёт на ${Math.round(data.replication.lagSec)} с`}
                </Label>
              ) : (
                <Label size="s" theme="danger">
                  не подключена
                </Label>
              )}
            </dd>
          </>
        )}

        {backups.length > 0 && (
          <>
            <Text as="dt" color="secondary" variant="body-1">
              Бэкапы
            </Text>
            <dd>
              {backups.map((backup) => (
                <Label key={backup.name} size="s" theme={backup.ageHours == null || backup.ageHours > 26 ? 'warning' : 'success'}>
                  {backup.name}: {backup.ageHours == null ? 'нет' : backup.ageHours < 1 ? 'меньше часа' : `${Math.floor(backup.ageHours)} ч`}
                </Label>
              ))}
            </dd>
          </>
        )}

        {certs.length > 0 && (
          <>
            <Text as="dt" color="secondary" variant="body-1">
              Сертификаты
            </Text>
            <dd>
              {certs.map((cert) => (
                <Label key={cert.name} size="s" theme={cert.days < 5 ? 'danger' : cert.days < 14 ? 'warning' : 'unknown'}>
                  {cert.name}: {cert.days} дн.
                </Label>
              ))}
            </dd>
          </>
        )}

        {data.probes.length > 0 && (
          <>
            <Text as="dt" color="secondary" variant="body-1">
              Доступность
            </Text>
            <dd>
              {data.probes.map((probe) => (
                <Label key={probe.name} size="s" theme={probe.ok ? 'success' : probe.critical ? 'danger' : 'warning'} title={probe.name}>
                  {probe.name.replace(/^https?:\/\//, '')}: {probe.ok ? `${probe.httpCode ?? 'ok'}${probe.ms != null ? ` · ${probe.ms} мс` : ''}` : probe.httpCode ? `код ${probe.httpCode}` : 'нет ответа'}
                </Label>
              ))}
            </dd>
          </>
        )}
      </dl>

      {data.services.length > 0 && (
        <Fragment>
          <Text variant="subheader-1">Сервисы</Text>
          {/* What needs a look is always on show; the ones that are fine fold into one line, so a healthy VM is not eight rows of green. */}
          {problemServices.length > 0 && (
            <dl className={styles.services}>
              {problemServices.map((service) => (
                <ServiceRow key={service.name} service={service} />
              ))}
            </dl>
          )}
          {fineServices.length > 0 &&
            (fineServices.length <= FOLD_FROM ? (
              <dl className={styles.services}>
                {fineServices.map((service) => (
                  <ServiceRow key={service.name} service={service} />
                ))}
              </dl>
            ) : (
              <details className={styles.fine}>
                <summary className={styles.fineSummary}>
                  {problemServices.length > 0 ? 'Остальные' : 'Все'} {fineServices.length} в порядке
                </summary>
                <dl className={styles.services}>
                  {fineServices.map((service) => (
                    <ServiceRow key={service.name} service={service} />
                  ))}
                </dl>
              </details>
            ))}
        </Fragment>
      )}
    </div>
  );
}

// The cloud VM — the first layer. It reports itself (infra/cloudagent), so "no report" means off, cut off or not set up, not "fine".
export function CloudCard() {
  const { data, isLoading, isError, error } = useGetDashboardCloudQuery(undefined, { pollingInterval: POLL_MS, skipPollingIfUnfocused: true });
  const list = Array.isArray(data) ? data : [];

  return (
    <Card id="tile-cloud" view="outlined" className={dashboardStyles.card}>
      <SectionHeader title="Облако (VM)" icon={Cloud} />
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
          VM ещё не присылала отчётов. Агент ставится на VM (infra/cloudagent: install.sh) и использует boards-only ключ владельца.
        </Text>
      ) : (
        list.map((cloud) => <CloudRow key={cloud.host} cloud={cloud} />)
      )}
    </Card>
  );
}
