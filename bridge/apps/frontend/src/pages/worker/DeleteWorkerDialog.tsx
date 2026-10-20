import { useState } from 'react';
import { Alert, Text } from '@gravity-ui/uikit';
import { Dialog } from '../../shared/ui/Dialog';

import { type FleetWorker, useDeleteWorkerMutation, useForgetLegacyWorkerMutation } from '../../store/api';

interface DeleteWorkerDialogProps {
  worker: FleetWorker;
  onClose: () => void;
}

// Says what will happen before it does: a worker that is running a job fails it, and a deleted worker's key stops
// working at once.
export function DeleteWorkerDialog({ worker, onClose }: DeleteWorkerDialogProps) {
  const [deleteWorker, { isLoading: isDeleting }] = useDeleteWorkerMutation();
  const [forgetLegacy, { isLoading: isForgetting }] = useForgetLegacyWorkerMutation();
  const [error, setError] = useState<string | null>(null);
  const isLegacy = worker.kind === 'legacy';

  const handleConfirm = async () => {
    setError(null);

    try {
      if (isLegacy) {
        await forgetLegacy(worker.name).unwrap();
      } else {
        await deleteWorker(worker.id as number).unwrap();
      }
      onClose();
    } catch {
      setError('Не удалось удалить worker');
    }
  };

  return (
    <Dialog open onClose={onClose} size="s" aria-labelledby="delete-worker-title">
      <Dialog.Header
        caption={isLegacy ? `Скрыть «${worker.name}»?` : `Удалить «${worker.name}»?`}
        id="delete-worker-title"
      />
      <Dialog.Body>
        <Text as="div">
          {isLegacy
            ? 'Запись исчезнет из списка. Процесс продолжит работать со своим ключом из переменной среды и снова появится, пока не будет остановлен или переведён на подключение по коду.'
            : "Ключ worker'а перестанет действовать сразу: процесс заметит это, сотрёт свой ключ и будет ждать нового подключения."}
        </Text>
        {!isLegacy && worker.activeJobs > 0 && (
          <Alert
            theme="warning"
            view="filled"
            message={`Сейчас он выполняет задачу (${worker.activeJobs}) — она будет остановлена с ошибкой, её можно запустить заново.`}
          />
        )}
        {!isLegacy && (
          <Text as="div" color="secondary" variant="caption-2">
            Задачи, закреплённые за этим worker&apos;ом, останутся в очереди и достанутся любому свободному.
          </Text>
        )}
        {error && <Alert theme="danger" view="filled" message={error} />}
      </Dialog.Body>
      <Dialog.Footer
        textButtonCancel="Отмена"
        textButtonApply={isLegacy ? 'Скрыть' : 'Удалить'}
        loading={isDeleting || isForgetting}
        propsButtonApply={{ view: 'outlined-danger' }}
        onClickButtonCancel={onClose}
        onClickButtonApply={() => void handleConfirm()}
      />
    </Dialog>
  );
}
