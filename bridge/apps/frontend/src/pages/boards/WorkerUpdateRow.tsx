import { useEffect, useState } from 'react';
import { Alert, Button, Label, Text } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { type Board, getErrorMessage, useCancelWorkerUpdateMutation, useRequestWorkerUpdateMutation } from '../../store/api';

import styles from './WorkerUpdateRow.module.css';

const CONFIRM_MS = 6000;

const RESULT_LABEL: Record<string, string> = {
  applied: 'применено',
  failed: 'ошибка',
};

// «Обновить worker» of one board: the board's agent pulls the worker image and recreates its worker container(s) with the same settings. The
// old container is stopped gracefully, so a job in progress finishes first (up to its own stop timeout) — hence the second, confirming click.
export function WorkerUpdateRow({ board }: { board: Board }) {
  const [request, { isLoading: isRequesting, error: requestError, reset: resetRequest }] = useRequestWorkerUpdateMutation();
  const [cancel, { isLoading: isCancelling, error: cancelError, reset: resetCancel }] = useCancelWorkerUpdateMutation();
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return undefined;

    const timer = setTimeout(() => setArmed(false), CONFIRM_MS);

    return () => clearTimeout(timer);
  }, [armed]);

  if (board.workers.length === 0 && !board.workerLast && !board.workerPending) return null;

  const failure = requestError ?? cancelError;
  const message = failure ? (typeof failure === 'string' ? failure : getErrorMessage(failure, 'Не удалось выполнить действие')) : null;
  const handleClick = () => {
    if (!armed) {
      setArmed(true);

      return;
    }

    setArmed(false);
    void request(board.host);
  };

  return (
    <div className={styles.row}>
      <div className={styles.line}>
        <Text variant="body-2">Worker</Text>
        {board.workers.map((worker) => (
          <Label key={worker.name} theme={worker.running ? 'success' : 'danger'} size="xs" title={worker.image}>
            {worker.name.replace('pipe-worker-pi-', '')} · {worker.running ? 'работает' : 'остановлен'}
          </Label>
        ))}
        {board.workerPending ? (
          <>
            <Label theme="info">ждёт плату: обновление</Label>
            <Button view="flat" size="s" loading={isCancelling} aria-label={`Отменить обновление worker на ${board.host}`} onClick={() => void cancel(board.host)}>
              Отменить
            </Button>
          </>
        ) : (
          board.workers.length > 0 && (
            <Button
              view={armed ? 'outlined-action' : 'normal'}
              size="s"
              loading={isRequesting}
              disabled={!board.online}
              aria-label={armed ? `Подтвердить обновление worker на ${board.host}` : `Обновить worker на ${board.host}`}
              onClick={handleClick}
            >
              {armed ? 'Обновить? Дождётся текущей задачи' : 'Обновить worker'}
            </Button>
          )
        )}
      </div>
      {message && (
        <Alert
          theme="danger"
          view="filled"
          message={message}
          onClose={() => {
            resetRequest();
            resetCancel();
          }}
        />
      )}
      {board.workerLast && (
        <Text variant="caption-2" color={board.workerLast.status === 'failed' ? 'danger' : 'secondary'}>
          Обновление worker: {RESULT_LABEL[board.workerLast.status] ?? board.workerLast.status}, {formatRelativeTime(board.workerLast.finishedAt ?? board.workerLast.createdAt)}
          {board.workerLast.result ? ` — ${board.workerLast.result}` : ''}
        </Text>
      )}
    </div>
  );
}
