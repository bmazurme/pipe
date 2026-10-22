import { useState } from 'react';
import { Alert, Select, Text } from '@gravity-ui/uikit';

import { Dialog } from '../../shared/ui/Dialog';
import { getErrorMessage, useAttachRunResultMutation, useListJobsQuery } from '../../store/api';
import styles from '../ChatPage.module.css';

interface AttachRunResultDialogProps {
  chatId: number;
  onClose: () => void;
}

const FINISHED = ['succeeded', 'failed', 'cancelled'];
const STATUS_LABEL: Record<string, string> = { succeeded: 'готово', failed: 'ошибка', cancelled: 'остановлено' };

// Adds the outcome of a finished Worker job to the chat as context (status, error, the end of its log): the model
// sees it from the next message on.
export function AttachRunResultDialog({ chatId, onClose }: AttachRunResultDialogProps) {
  const { data: jobs } = useListJobsQuery();
  const [attach, { isLoading }] = useAttachRunResultMutation();
  const [jobId, setJobId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finished = (jobs ?? [])
    .filter((job) => FINISHED.includes(job.status))
    .sort((a, b) => b.id - a.id)
    .slice(0, 50);

  const handleAttach = async () => {
    if (jobId === null) return setError('Сначала выберите запуск из списка');

    setError(null);

    try {
      await attach({ chatId, jobId }).unwrap();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось прикрепить результат'));
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="s" aria-labelledby="attach-run-title">
      <Dialog.Header caption="Прикрепить результат задачи" id="attach-run-title" />
      <Dialog.Body>
        <div className={styles.contextForm}>
          <Text variant="body-1" color="secondary">
            Итог выбранного запуска (статус, ошибка, конец лога) попадёт в контекст этого чата — модель увидит его со следующего сообщения.
          </Text>
          {finished.length === 0 ? (
            <Text>Завершённых запусков пока нет.</Text>
          ) : (
            <Select
              aria-label="Запуск"
              placeholder="Выберите запуск"
              width="max"
              value={jobId === null ? [] : [String(jobId)]}
              onUpdate={([value]) => setJobId(value ? Number(value) : null)}
              options={finished.map((job) => ({
                value: String(job.id),
                content: `#${job.id} · ${job.model} · ${STATUS_LABEL[job.status] ?? job.status}${job.taskKey ? ` · ${job.taskKey}` : ''}`,
              }))}
            />
          )}
          {error && <Alert theme="danger" view="filled" message={error} />}
        </div>
      </Dialog.Body>
      <Dialog.Footer
        textButtonCancel="Отмена"
        textButtonApply="Прикрепить"
        propsButtonApply={{ loading: isLoading, disabled: finished.length === 0 }}
        onClickButtonCancel={onClose}
        onClickButtonApply={() => void handleAttach()}
      />
    </Dialog>
  );
}
