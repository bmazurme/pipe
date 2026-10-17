import { useState } from 'react';
import { ArrowRotateRight, Clock } from '@gravity-ui/icons';
import { Alert, Button, Dialog, Icon } from '@gravity-ui/uikit';

import { getErrorMessage, useListClaudeCredentialsQuery, useRetryJobMutation, WorkerJob } from '../../store/api';
import { limitResetAt } from './claudeLimits';

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
  const failedOnLimit = job.status === 'failed' && /session limit/i.test(job.errorMessage ?? '');
  // Only asked for when it matters: the snapshot of the token the job ran on.
  const { data: credentials } = useListClaudeCredentialsQuery(undefined, { skip: !failedOnLimit });

  if (job.status !== 'failed' && job.status !== 'cancelled') return null;

  const credential = credentials?.find((item) => item.id === job.claudeCredentialId || item.name === job.usedClaudeCredentialName);
  const resetAt = limitResetAt(job.errorMessage, credential?.limits, Date.now());

  const handleRetry = async (notBefore?: string) => {
    setError(null);

    try {
      await retryJob({ id: job.id, notBefore }).unwrap();
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

      {resetAt && (
        <Button
          view={compact ? 'flat-secondary' : 'outlined'}
          size={compact ? 's' : 'm'}
          loading={isLoading}
          aria-label={`Перезапустить после сброса лимита: задача #${job.id}`}
          title={`Перезапустить после сброса лимита (${new Date(resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`}
          onClick={() => void handleRetry(resetAt)}
        >
          <Icon data={Clock} size={16} />
          {!compact && 'Перезапустить после сброса лимита'}
        </Button>
      )}

      <Dialog open={error !== null} onClose={() => setError(null)} maxWidth="s" aria-labelledby={`retry-job-${job.id}`}>
        <Dialog.Header caption={`Не удалось перезапустить задачу #${job.id}`} id={`retry-job-${job.id}`} />
        <Dialog.Body>{error && <Alert theme="danger" view="filled" message={error} />}</Dialog.Body>
        <Dialog.Footer textButtonApply="Закрыть" onClickButtonApply={() => setError(null)} />
      </Dialog>
    </>
  );
}
