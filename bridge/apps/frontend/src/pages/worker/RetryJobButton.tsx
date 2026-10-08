import { useState } from 'react';
import { ArrowRotateRight } from '@gravity-ui/icons';
import { Alert, Button, Dialog, Icon } from '@gravity-ui/uikit';

import { getErrorMessage, useRetryJobMutation, WorkerJob } from '../../store/api';

interface RetryJobButtonProps {
  job: WorkerJob;
  /** Icon-only, for a row in the list. */
  compact?: boolean;
}

// "Retry" for a job that failed or was stopped: queues a NEW job over the same
// parcel, model and credential (the failed one stays as history). Only the
// failure case needs a dialog — a retry itself is cheap and undoable (stop it).
export function RetryJobButton({ job, compact = false }: RetryJobButtonProps) {
  const [retryJob, { isLoading }] = useRetryJobMutation();
  const [error, setError] = useState<string | null>(null);

  if (job.status !== 'failed' && job.status !== 'cancelled') return null;

  const handleRetry = async () => {
    setError(null);

    try {
      await retryJob(job.id).unwrap();
    } catch (err) {
      // transformErrorResponse has already reduced the error to bridge's message.
      setError(typeof err === 'string' && err ? err : getErrorMessage(err, 'Не удалось перезапустить задачу'));
    }
  };

  return (
    <>
      <Button
        view={compact ? 'flat-secondary' : 'outlined'}
        size={compact ? 's' : 'm'}
        loading={isLoading}
        aria-label={compact ? `Перезапустить: задача #${job.id}` : undefined}
        title={compact ? 'Перезапустить' : undefined}
        onClick={() => void handleRetry()}
      >
        <Icon data={ArrowRotateRight} size={16} />
        {!compact && 'Перезапустить'}
      </Button>

      <Dialog open={error !== null} onClose={() => setError(null)} maxWidth="s" aria-labelledby={`retry-job-${job.id}`}>
        <Dialog.Header caption={`Не удалось перезапустить задачу #${job.id}`} id={`retry-job-${job.id}`} />
        <Dialog.Body>{error && <Alert theme="danger" view="filled" message={error} />}</Dialog.Body>
        <Dialog.Footer textButtonApply="Закрыть" onClickButtonApply={() => setError(null)} />
      </Dialog>
    </>
  );
}
