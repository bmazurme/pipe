import { useEffect, useState } from 'react';
import { Stop } from '@gravity-ui/icons';
import { Alert, Button, Dialog, Icon } from '@gravity-ui/uikit';

import { getErrorMessage, useCancelJobMutation, WorkerJob } from '../../store/api';
import { FORCE_STOP_AFTER_MS, isActive, isStopping } from './constants';

interface CancelJobButtonProps {
  job: WorkerJob;
  /** Icon-only, for a row in the list. */
  compact?: boolean;
}

// "Stop" for a job that has not finished. A queued job simply gets cancelled; one
// a worker holds is asked to stop, and shows "stopping" until it confirms — and if
// the worker never does (it crashed, it is offline), the owner can force it after a
// while. Always behind a confirmation: stopping throws the work done so far away.
export function CancelJobButton({ job, compact = false }: CancelJobButtonProps) {
  const [cancelJob, { isLoading }] = useCancelJobMutation();
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const stopping = isStopping(job);
  const waitedMs = job.cancelRequestedAt ? now - new Date(job.cancelRequestedAt).getTime() : 0;
  const canForce = stopping && waitedMs >= FORCE_STOP_AFTER_MS;

  // Re-evaluates whether "force" should be offered while a stop is pending.
  useEffect(() => {
    if (!stopping) return undefined;

    const timer = setInterval(() => setNow(Date.now()), 5000);

    return () => clearInterval(timer);
  }, [stopping]);

  if (!isActive(job.status)) return null;

  const handleConfirm = async () => {
    setError(null);

    try {
      await cancelJob({ id: job.id, force: canForce }).unwrap();
      setIsConfirming(false);
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось остановить задачу'));
    }
  };

  const label = stopping ? (canForce ? 'Остановить принудительно' : 'Останавливается…') : 'Остановить';
  const disabled = stopping && !canForce;

  return (
    <>
      <Button
        view={compact ? 'flat-danger' : 'outlined-danger'}
        size={compact ? 's' : 'm'}
        disabled={disabled}
        aria-label={compact ? `${label}: задача #${job.id}` : undefined}
        title={compact ? label : undefined}
        onClick={() => {
          setError(null);
          setIsConfirming(true);
        }}
      >
        <Icon data={Stop} size={16} />
        {!compact && label}
      </Button>

      <Dialog open={isConfirming} onClose={() => setIsConfirming(false)} maxWidth="s" aria-labelledby={`stop-job-${job.id}`}>
        <Dialog.Header caption={`Остановить задачу #${job.id}?`} id={`stop-job-${job.id}`} />
        <Dialog.Body>
          {job.status === 'queued'
            ? 'Задача ещё не взята worker — она просто будет отменена.'
            : canForce
              ? 'Worker не подтвердил остановку. Задача будет помечена остановленной сразу, без ожидания; если worker ещё жив, его результат не примут.'
              : 'Выполнение будет прервано, результат не сохранится. Всё, что worker успел сделать, пропадёт.'}
          {error && <Alert theme="danger" view="filled" message={error} />}
        </Dialog.Body>
        <Dialog.Footer
          textButtonCancel="Не останавливать"
          textButtonApply={canForce ? 'Остановить принудительно' : 'Остановить'}
          propsButtonApply={{ view: 'outlined-danger', loading: isLoading }}
          onClickButtonCancel={() => setIsConfirming(false)}
          onClickButtonApply={() => void handleConfirm()}
        />
      </Dialog>
    </>
  );
}
