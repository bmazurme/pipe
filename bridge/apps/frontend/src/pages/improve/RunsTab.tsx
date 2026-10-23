import { useEffect, useState } from 'react';
import { ArrowUpRightFromSquare, Rocket, Stop } from '@gravity-ui/icons';
import { Alert, Button, Icon, Label, SegmentedRadioGroup, Skeleton, Text } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { Dialog } from '../../shared/ui/Dialog';
import { getErrorMessage, ImproveRun, useCancelImproveRunMutation, useListImproveRunsQuery, useRetryImprovePublishMutation } from '../../store/api';
import { EmptyState } from '../../widgets/EmptyState';
import styles from '../ImprovePage.module.css';
import { isActiveRun, modelLabel, RUN_STATUS_LABEL, RUN_STATUS_THEME } from './improveLabels';

const FAST_POLL_MS = 5000;
const SLOW_POLL_MS = 30000;

// Runs accumulate forever; the tab should open on what is recent, with the
// rest one click away instead of an ever-longer scroll (same reasoning as
// the Worker page's job list).
const INITIAL_VISIBLE_RUNS = 8;

type RunFilter = 'all' | 'active' | 'failed';

function matches(run: ImproveRun, filter: RunFilter): boolean {
  if (filter === 'active') return isActiveRun(run);
  if (filter === 'failed') return run.status === 'failed';

  return true;
}

export function RunsTab() {
  // Fast while something is working, slow otherwise, paused in a background tab.
  const [pollingInterval, setPollingInterval] = useState(FAST_POLL_MS);
  const { data: runs, isLoading, isError, error: listError, refetch } = useListImproveRunsQuery(undefined, { pollingInterval, skipPollingIfUnfocused: true });
  const [cancel, { isLoading: isCancelling, originalArgs: cancellingId, error }] = useCancelImproveRunMutation();
  const [retry, { isLoading: isRetrying, error: retryError }] = useRetryImprovePublishMutation();
  const hasActive = Boolean(runs?.some((run) => isActiveRun(run)));
  const [filter, setFilter] = useState<RunFilter>('all');
  const [showAll, setShowAll] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState<{ id: number } | null>(null);

  useEffect(() => {
    setPollingInterval(hasActive ? FAST_POLL_MS : SLOW_POLL_MS);
  }, [hasActive]);

  const activeCount = runs?.filter((run) => isActiveRun(run)).length ?? 0;
  const failedCount = runs?.filter((run) => run.status === 'failed').length ?? 0;
  const filtered = (runs ?? []).filter((run) => matches(run, filter));
  const visibleRuns = showAll ? filtered : filtered.slice(0, INITIAL_VISIBLE_RUNS);
  const hiddenCount = filtered.length - visibleRuns.length;

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

      {runs && runs.length > 0 && (
        <div className={styles.filterRow}>
          <SegmentedRadioGroup
            size="m"
            value={filter}
            onUpdate={(value) => {
              setFilter(value as RunFilter);
              setShowAll(false);
            }}
            aria-label="Фильтр запусков"
            options={[
              { value: 'all', content: 'Все' },
              { value: 'active', content: activeCount > 0 ? `Активные (${activeCount})` : 'Активные' },
              { value: 'failed', content: failedCount > 0 ? `С ошибкой (${failedCount})` : 'С ошибкой' },
            ]}
          />
        </div>
      )}

      {runs && runs.length > 0 && filtered.length === 0 && (
        <EmptyState
          icon={Rocket}
          title={filter === 'active' ? 'Активных запусков нет' : 'Запусков с ошибкой нет'}
          description="Выберите «Все», чтобы увидеть остальные."
        />
      )}

      {visibleRuns.map((run) => (
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
              <Button view="flat-danger" size="s" loading={isCancelling && cancellingId === run.id} aria-label={`Остановить запуск #${run.id}`} onClick={() => setConfirmCancel({ id: run.id })}>
                <Icon data={Stop} size={16} />
              </Button>
            )}
          </div>
        </div>
      ))}

      {hiddenCount > 0 && (
        <Button view="flat-secondary" onClick={() => setShowAll(true)}>
          Показать ещё {hiddenCount}
        </Button>
      )}

      <Dialog open={confirmCancel !== null} onClose={() => setConfirmCancel(null)} maxWidth="s" aria-labelledby="run-cancel-title">
        <Dialog.Header caption={`Остановить запуск #${confirmCancel?.id}?`} id="run-cancel-title" />
        <Dialog.Body>
          <Text variant="body-2">Запуск будет остановлен, вернуть его нельзя.</Text>
        </Dialog.Body>
        <Dialog.Footer
          textButtonCancel="Не останавливать"
          textButtonApply="Остановить"
          propsButtonApply={{ view: 'outlined-danger' }}
          onClickButtonCancel={() => setConfirmCancel(null)}
          onClickButtonApply={() => {
            if (confirmCancel) void cancel(confirmCancel.id);
            setConfirmCancel(null);
          }}
        />
      </Dialog>
    </div>
  );
}
