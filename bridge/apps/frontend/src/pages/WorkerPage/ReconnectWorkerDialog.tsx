import { Alert, Text } from '@gravity-ui/uikit';
import { Dialog } from '../../shared/ui/Dialog';

import type { FleetWorker } from '../../store/api';

interface ReconnectWorkerDialogProps {
  worker: FleetWorker;
  onConfirm: () => void;
  onClose: () => void;
}

// A worker that is already enrolled loses its key the moment a new code is issued — one stray click on the card would
// knock a working worker offline, so this says so first.
export function ReconnectWorkerDialog({ worker, onConfirm, onClose }: ReconnectWorkerDialogProps) {
  return (
    <Dialog open onClose={onClose} size="s" aria-labelledby="reconnect-worker-title">
      <Dialog.Header caption={`Подключить «${worker.name}» заново?`} id="reconnect-worker-title" />
      <Dialog.Body>
        <Text as="div">
          Будет выпущен новый одноразовый код, а текущий ключ worker&apos;а перестанет действовать сразу: процесс сотрёт его и будет ждать
          подключения по новому коду. Нужно только если worker переносят на другой компьютер или ключ потерян.
        </Text>
        {worker.activeJobs > 0 && (
          <Alert
            theme="warning"
            view="filled"
            message={`Сейчас он выполняет задачу (${worker.activeJobs}) — она будет остановлена с ошибкой, её можно запустить заново.`}
          />
        )}
        <Text as="div" color="secondary" variant="caption-2">
          Настройки, VPN и модели сохранятся.
        </Text>
      </Dialog.Body>
      <Dialog.Footer
        textButtonCancel="Отмена"
        textButtonApply="Подключить заново"
        propsButtonApply={{ view: 'outlined-danger' }}
        onClickButtonCancel={onClose}
        onClickButtonApply={onConfirm}
      />
    </Dialog>
  );
}
