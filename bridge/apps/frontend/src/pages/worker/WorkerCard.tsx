import { useState } from 'react';
import { ArrowsRotateRight, Gear, Server, TrashBin } from '@gravity-ui/icons';
import { Alert, Button, Card, Icon, Label, Switch, Text } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { type FleetWorker, useUpdateWorkerMutation, type WorkerJob } from '../../store/api';
import styles from '../WorkerPage.module.css';
import { WorkerLimits } from './WorkerLimits';
import { describeModels, modelName, WORKER_STATE_LABEL, WORKER_STATE_THEME } from './fleet';

interface WorkerCardProps {
  worker: FleetWorker;
  /** The job this worker is running right now, if any. */
  activeJob?: WorkerJob;
  onOpenJob: (jobId: number) => void;
  onSettings: (worker: FleetWorker) => void;
  onReconnect: (worker: FleetWorker) => void;
  onDelete: (worker: FleetWorker) => void;
}

function formatTimeout(seconds: number): string {
  return seconds % 60 === 0 ? `${seconds / 60} мин` : `${seconds} с`;
}

export function WorkerCard({ worker, activeJob, onOpenJob, onSettings, onReconnect, onDelete }: WorkerCardProps) {
  const [updateWorker, { isLoading: isToggling }] = useUpdateWorkerMutation();
  const [toggleError, setToggleError] = useState<string | null>(null);
  const isLegacy = worker.kind === 'legacy';
  const isPending = worker.state === 'pending';

  const handleToggle = async (enabled: boolean) => {
    setToggleError(null);

    try {
      await updateWorker({ id: worker.id as number, enabled }).unwrap();
    } catch {
      setToggleError('Не удалось изменить состояние');
    }
  };

  const facts: string[] = [];

  if (worker.hostname) facts.push(worker.hostname);
  if (worker.version) facts.push(`v${worker.version}`);
  if (worker.lastSeenAt) facts.push(`на связи ${formatRelativeTime(worker.lastSeenAt)}`);

  return (
    <Card view="outlined" className={styles.workerCard}>
      <div className={styles.workerHead}>
        <div className={styles.workerTitle}>
          <Icon data={Server} size={18} />
          <Text variant="subheader-2" as="h3">
            {worker.name}
          </Text>
          <Label theme={WORKER_STATE_THEME[worker.state]}>{WORKER_STATE_LABEL[worker.state]}</Label>
          {isLegacy && (
            <Label theme="clear" title="Ключ задан в переменной среды worker'а — прежний способ">
              переменные среды
            </Label>
          )}
        </div>
        {!isLegacy && !isPending && (
          <Switch
            checked={worker.enabled}
            disabled={isToggling}
            onUpdate={(checked) => void handleToggle(checked)}
            content="Берёт задачи"
            controlProps={{ 'aria-label': `${worker.name}: берёт задачи` }}
          />
        )}
      </div>

      {facts.length > 0 && (
        <Text color="secondary" variant="caption-2">
          {facts.join(' · ')}
        </Text>
      )}

      {!isPending && !isLegacy && <WorkerLimits worker={worker} />}

      {isPending && (
        <Text color="secondary">
          {worker.enrollmentPending
            ? 'Ещё не подключён: запустите команду из подсказки с одноразовым кодом.'
            : 'Код подключения истёк — получите новый.'}
        </Text>
      )}

      {isLegacy && (
        <Alert
          theme="info"
          view="outlined"
          message="Этот worker работает по персональному API-ключу из переменной среды и не берёт закреплённые задачи. Добавьте его здесь и подключите кодом — ключ из переменных можно будет убрать."
        />
      )}

      {!isPending && !isLegacy && (
        <div className={styles.workerFacts}>
          <Text variant="caption-2" color="secondary">
            Модели: {describeModels(worker.models)}
          </Text>
          <Text variant="caption-2" color="secondary">
            Лимит задачи: {formatTimeout(worker.jobTimeoutSec)}
          </Text>
          <Text variant="caption-2" color="secondary">
            Опрос: {worker.pollIntervalSec} с
          </Text>
          {worker.vpnHost && (
            <Text variant="caption-2" color="secondary">
              VPN: {worker.vpnConnectionName ? `${worker.vpnConnectionName} · ${worker.vpnHost}` : worker.vpnHost}
              {worker.vpnSource === 'active' ? ' (активное)' : ''}
            </Text>
          )}
          {worker.proxyUrl && (
            <Text variant="caption-2" color="secondary">
              Прокси: {worker.proxyUrl}
            </Text>
          )}
          {(worker.capabilities ?? []).includes('fusion') && (
            <Text variant="caption-2" color="secondary">
              Fusion 360
            </Text>
          )}
          {!worker.chatEnabled && (
            <Text variant="caption-2" color="secondary">
              Чат выключен
            </Text>
          )}
        </div>
      )}

      {worker.state === 'busy' && (
        <Text variant="body-2">
          Сейчас:{' '}
          {activeJob ? (
            <Button view="flat" size="s" onClick={() => onOpenJob(activeJob.id)}>
              задача #{activeJob.id} · {modelName(activeJob.model)}
            </Button>
          ) : (
            `выполняет задач: ${worker.activeJobs}`
          )}
        </Text>
      )}

      {toggleError && <Alert theme="danger" view="filled" message={toggleError} />}

      <div className={styles.workerActions}>
        {isLegacy ? (
          <>
            <span className={styles.workerActionsSpacer} />
            <Button view="flat-secondary" onClick={() => onDelete(worker)}>
              Скрыть
            </Button>
          </>
        ) : (
          <>
            {isPending ? (
              <Button view="action" onClick={() => onReconnect(worker)}>
                <Icon data={ArrowsRotateRight} size={16} />
                Показать код
              </Button>
            ) : (
              <>
                <Button view="normal" onClick={() => onSettings(worker)}>
                  <Icon data={Gear} size={16} />
                  Настройки
                </Button>
                <Button view="flat-secondary" onClick={() => onReconnect(worker)}>
                  <Icon data={ArrowsRotateRight} size={16} />
                  Подключить заново
                </Button>
              </>
            )}
            <span className={styles.workerActionsSpacer} />
            <Button view="flat-danger" onClick={() => onDelete(worker)} aria-label={`Удалить worker: ${worker.name}`}>
              <Icon data={TrashBin} size={16} />
              Удалить
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
