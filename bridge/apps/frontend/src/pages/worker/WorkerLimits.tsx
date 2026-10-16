import { useState } from 'react';
import { ArrowsRotateRight } from '@gravity-ui/icons';
import { Button, Icon, Loader, Text } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { type FleetWorker, useRefreshWorkerLimitsMutation } from '../../store/api';
import styles from '../WorkerPage.module.css';
import { ClaudeLimitsView } from './ClaudeLimitsView';

// How long to wait for the worker's answer before saying it did not come (it answers on its next poll, plus a few seconds for the call).
export const REFRESH_WAIT_MS = 3 * 60 * 1000;

export type RefreshState = 'idle' | 'waiting' | 'no-answer';

/** Where a refresh request stands: nothing asked, asked and the worker has not reported since, or it did not answer in time. */
export function refreshState(
  worker: Pick<FleetWorker, 'claudeLimits' | 'limitsRefreshRequestedAt'>,
  now: number,
): RefreshState {
  const requested = worker.limitsRefreshRequestedAt ? new Date(worker.limitsRefreshRequestedAt).getTime() : 0;

  if (!requested) return 'idle';

  const reported = worker.claudeLimits ? new Date(worker.claudeLimits.reportedAt).getTime() : 0;

  if (reported >= requested) return 'idle';

  return now - requested < REFRESH_WAIT_MS ? 'waiting' : 'no-answer';
}

interface Props {
  worker: FleetWorker;
  now?: number;
}

// The plan limits of a worker's Claude token with a "refresh" button: the worker probes them (one tiny call) and reports back. The
// numbers otherwise only change after a run, so on an idle worker they go stale.
export function WorkerLimits({ worker, now = Date.now() }: Props) {
  const [refresh, { isLoading }] = useRefreshWorkerLimitsMutation();
  const [error, setError] = useState<string | null>(null);
  const state = refreshState(worker, now);
  const offline = worker.state === 'offline' || worker.state === 'pending';

  const handleRefresh = async () => {
    setError(null);

    try {
      await refresh(worker.id as number).unwrap();
    } catch (failure) {
      setError(typeof failure === 'string' ? failure : 'Не удалось запросить обновление');
    }
  };

  return (
    <div className={styles.limitsBlock}>
      <ClaudeLimitsView limits={worker.claudeLimits} />

      <div className={styles.limitsActions}>
        <Button
          size="s"
          view="flat-secondary"
          loading={isLoading}
          disabled={offline || state === 'waiting'}
          title={
            offline ? 'Worker не на связи' : 'Worker сделает один маленький запрос к Claude и пришлёт актуальные лимиты'
          }
          onClick={() => void handleRefresh()}
        >
          <Icon data={ArrowsRotateRight} size={14} />
          Обновить лимиты
        </Button>

        {state === 'waiting' && (
          <span className={styles.limitsStatus} role="status">
            <Loader size="s" />
            <Text variant="caption-2" color="secondary">
              Запрошено, worker ответит в течение нескольких секунд…
            </Text>
          </span>
        )}
        {state === 'no-answer' && (
          <Text variant="caption-2" color="warning" role="status">
            Worker не ответил на запрос. Возможно, он работает на старой версии образа — обновите его.
          </Text>
        )}
        {state === 'idle' && !worker.claudeLimits && (
          <Text variant="caption-2" color="secondary">
            Лимиты ещё не получены
            {worker.limitsRefreshRequestedAt ? '' : ' — они появятся после первого запуска или по кнопке'}.
          </Text>
        )}
        {state === 'idle' && worker.claudeLimits && worker.limitsRefreshMin > 0 && (
          <Text variant="caption-2" color="secondary">
            Обновляются сами каждые {worker.limitsRefreshMin} мин · последний отчёт{' '}
            {formatRelativeTime(worker.claudeLimits.reportedAt)}
          </Text>
        )}
        {error && (
          <Text variant="caption-2" color="danger" role="alert">
            {error}
          </Text>
        )}
      </div>
    </div>
  );
}
