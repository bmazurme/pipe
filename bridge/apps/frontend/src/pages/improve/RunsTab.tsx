import { useEffect, useState } from 'react';
import { ArrowUpRightFromSquare, Rocket, Stop } from '@gravity-ui/icons';
import { Alert, Button, Icon, Label, Skeleton, Text } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { getErrorMessage, useCancelImproveRunMutation, useListImproveRunsQuery, useRetryImprovePublishMutation } from '../../store/api';
import { EmptyState } from '../../widgets/EmptyState';
import styles from '../ImprovePage.module.css';
import { isActiveRun, modelLabel, RUN_STATUS_LABEL, RUN_STATUS_THEME } from './improveLabels';

const FAST_POLL_MS = 5000;
const SLOW_POLL_MS = 30000;

export function RunsTab() {
  // Fast while something is working, slow otherwise, paused in a background tab.
  const [pollingInterval, setPollingInterval] = useState(FAST_POLL_MS);
  const { data: runs, isLoading, isError, error: listError, refetch } = useListImproveRunsQuery(undefined, { pollingInterval, skipPollingIfUnfocused: true });
  const [cancel, { isLoading: isCancelling, originalArgs: cancellingId, error }] = useCancelImproveRunMutation();
  const [retry, { isLoading: isRetrying, error: retryError }] = useRetryImprovePublishMutation();
  const hasActive = Boolean(runs?.some((run) => isActiveRun(run)));

  useEffect(() => {
    setPollingInterval(hasActive ? FAST_POLL_MS : SLOW_POLL_MS);
  }, [hasActive]);

  return (
    <div className={styles.panel}>
      {error && <Alert theme="danger" view="filled" message={getErrorMessage(error, 'Не удалось остановить')} />}
      {retryError && <Alert theme="danger" view="filled" message={getErrorMessage(retryError, 'Не удалось повторить публикацию')} />}
      {isError && (
        <Alert
          theme="danger"
          view="filled"
          message={getErrorMessage(listError, 'Не удалось загрузить запуски')}
          actions={
            <Button view="outlined" size="s" onClick={() => void refetch()}>
              Повторить
            </Button>
          }
        />
      )}
      {isLoading && <Skeleton style={{ height: 120 }} />}

      {runs && runs.length === 0 && (
        <EmptyState icon={Rocket} title="Запусков ещё не было" description="Запустите задачу на вкладке «Задачи» или дождитесь расписания." />
      )}

      {runs?.map((run) => (
        <div key={run.id} className={styles.row}>
          <div className={styles.rowMain}>
            <Text variant="body-2" ellipsis title={run.issueTitle}>
              {run.issueNumber ? `#${run.issueNumber} ` : ''}{run.issueTitle}
            </Text>
            <Text variant="caption-2" color="secondary">
              {modelLabel(run.model)} · {run.trigger === 'schedule' ? 'по расписанию' : 'вручную'} · {formatRelativeTime(run.createdAt)}
              {run.note && ` · ${run.note}`}
            </Text>
            {run.error && (
              <Text variant="caption-2" color="danger" ellipsis title={run.error}>
                {run.error}
              </Text>
            )}
          </div>
          <div className={styles.rowActions}>
            <Label theme={RUN_STATUS_THEME[run.status]}>{RUN_STATUS_LABEL[run.status]}</Label>
            {run.prUrl && (
              <a href={run.prUrl} target="_blank" rel="noreferrer noopener" aria-label={`PR #${run.prNumber}`}>
                <Icon data={ArrowUpRightFromSquare} size={16} />
              </a>
            )}
            {run.status === 'failed' && run.kind !== 'analysis' && run.jobId !== null && (
              <Button view="outlined" size="s" loading={isRetrying} onClick={() => void retry(run.id)}>
                Повторить публикацию
              </Button>
            )}
            {isActiveRun(run) && run.status !== 'publishing' && (
              <Button view="flat-danger" size="s" loading={isCancelling && cancellingId === run.id} aria-label={`Остановить запуск #${run.id}`} onClick={() => void cancel(run.id)}>
                <Icon data={Stop} size={16} />
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
