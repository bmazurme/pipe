import { useState } from 'react';
import { Alert, Button, Text } from '@gravity-ui/uikit';
import { Link } from 'react-router-dom';

import { getErrorMessage, useListClaudeCredentialsQuery, useRetryJobMutation, type WorkerJob } from '../../store/api';
import { diagnoseFailure } from './failureDiagnosis';

interface FailureDiagnosisCardProps {
  job: WorkerJob;
}

// Under a failed job's error: what most likely went wrong and the one-press next step. Only for the failures worth a guess
// (failureDiagnosis.ts); for anything else the card is not there and the usual Retry buttons below are all there is.
export function FailureDiagnosisCard({ job }: FailureDiagnosisCardProps) {
  const failed = job.status === 'failed' && Boolean(job.errorMessage);
  const { data: credentials } = useListClaudeCredentialsQuery(undefined, { skip: !failed });
  const [retryJob, { isLoading, originalArgs }] = useRetryJobMutation();
  const [started, setStarted] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!failed) return null;

  const diagnosis = diagnoseFailure(job, credentials ?? [], Date.now());

  if (!diagnosis) return null;

  const run = async (retry: NonNullable<(typeof diagnosis.actions)[number]['retry']>) => {
    setError(null);

    try {
      const created = await retryJob({ id: job.id, ...retry }).unwrap();

      setStarted(created.id);
    } catch (err) {
      setError(typeof err === 'string' && err ? err : getErrorMessage(err, 'Не удалось перезапустить задачу'));
    }
  };

  return (
    <Alert
      theme="info"
      view="outlined"
      title={diagnosis.title}
      message={
        <>
          <Text as="p" variant="body-1">
            {diagnosis.hint}
          </Text>
          {diagnosis.actions.length > 0 && started === null && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              {diagnosis.actions.map((action) =>
                action.to ? (
                  <Link key={action.id} to={action.to}>
                    <Button view="outlined" size="m" component="span">
                      {action.label}
                    </Button>
                  </Link>
                ) : (
                  <Button key={action.id} view="action" size="m" loading={isLoading && originalArgs?.id === job.id} onClick={() => void run(action.retry ?? {})}>
                    {action.label}
                  </Button>
                ),
              )}
            </div>
          )}
          {started !== null && <Text as="p" variant="body-1">Запущено как задача #{started}.</Text>}
          {error && <Alert theme="danger" view="filled" message={error} />}
        </>
      }
    />
  );
}
