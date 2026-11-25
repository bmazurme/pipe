import { useState } from 'react';
import { Play } from '@gravity-ui/icons';
import { Alert, Button, Icon } from '@gravity-ui/uikit';

import { getErrorMessage, useStartJobNowMutation, WorkerJob } from '../../store/api';

interface StartNowButtonProps {
  job: WorkerJob;
  /** Icon-only, for a row in the list. */
  compact?: boolean;
}

// "Запустить сейчас" for a queued job held back by notBefore: clears the delay so the next claim can take it.
export function StartNowButton({ job, compact = false }: StartNowButtonProps) {
  const [startJobNow, { isLoading }] = useStartJobNowMutation();
  const [error, setError] = useState<string | null>(null);

  if (job.status !== 'queued' || !job.notBefore || new Date(job.notBefore).getTime() <= Date.now()) {
    return null;
  }

  const start = async () => {
    setError(null);
    try {
      await startJobNow(job.id).unwrap();
    } catch (err) {
      setError(typeof err === 'string' ? err : getErrorMessage(err, 'Не удалось запустить задачу'));
    }
  };

  return (
    <>
      <Button
        view="outlined"
        size={compact ? 's' : 'm'}
        loading={isLoading}
        onClick={start}
        title="Запустить сейчас"
        aria-label="Запустить сейчас"
      >
        <Icon data={Play} size={14} />
        {compact ? null : 'Запустить сейчас'}
      </Button>
      {error && <Alert theme="danger" message={error} />}
    </>
  );
}
