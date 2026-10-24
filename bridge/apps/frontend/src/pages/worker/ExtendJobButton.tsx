import { useState } from 'react';
import { Alert, Button, DropdownMenu } from '@gravity-ui/uikit';

import { getErrorMessage, useExtendJobMutation, WorkerJob } from '../../store/api';
import { isActive, isStopping } from './constants';

const CLAUDE_MODELS = ['sonnet', 'opus', 'haiku'];
const OTHER_MINUTES = [15, 60] as const;

interface ExtendJobButtonProps {
  job: WorkerJob;
}

// "+30 мин" for a Claude job a worker is running: raises its time limit without restarting it.
export function ExtendJobButton({ job }: ExtendJobButtonProps) {
  const [extendJob, { isLoading }] = useExtendJobMutation();
  const [error, setError] = useState<string | null>(null);

  if (!CLAUDE_MODELS.includes(job.model) || (job.status !== 'claimed' && job.status !== 'running') || isStopping(job) || !isActive(job.status)) {
    return null;
  }

  const extend = async (minutes: 15 | 30 | 60) => {
    setError(null);
    try {
      await extendJob({ id: job.id, minutes }).unwrap();
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось продлить задачу'));
    }
  };

  return (
    <>
      <Button view="outlined" loading={isLoading} onClick={() => extend(30)}>
        +30 мин
      </Button>
      <DropdownMenu
        items={OTHER_MINUTES.map((minutes) => ({ text: `+${minutes} мин`, action: () => extend(minutes) }))}
        switcher={<Button view="outlined">⋯</Button>}
      />
      {error && <Alert theme="danger" message={error} />}
    </>
  );
}
