import { useState } from 'react';
import { Alert, Button, Select, Text } from '@gravity-ui/uikit';

import { Dialog } from '../../shared/ui/Dialog';
import { useClearFinishedJobsMutation } from '../../store/api';

const AGE_OPTIONS = [
  { value: '7', content: 'Старше 7 дней' },
  { value: '30', content: 'Старше 30 дней' },
  { value: '90', content: 'Старше 90 дней' },
];

// Deletes finished jobs past a chosen age in one go. Jobs that an Improve or Lab run still links to are kept by bridge.
export function ClearFinishedJobsButton() {
  const [clearFinished, { isLoading }] = useClearFinishedJobsMutation();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState('30');
  const [removed, setRemoved] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setRemoved(null);
    setError(null);
  };

  const handleApply = async () => {
    setError(null);

    try {
      const result = await clearFinished(Number(days)).unwrap();
      setRemoved(result.removed);
    } catch (err) {
      setError(typeof err === 'string' ? err : 'Не удалось удалить задачи');
    }
  };

  return (
    <>
      <Button view="flat-secondary" size="m" onClick={() => setOpen(true)}>
        Очистить завершённые
      </Button>
      {open && (
        <Dialog open onClose={close} size="s" aria-labelledby="clear-finished-title">
          <Dialog.Header caption="Очистить завершённые задачи?" id="clear-finished-title" />
          <Dialog.Body>
            <Text as="div">
              Будут удалены выполненные, упавшие и отменённые задачи старше выбранного срока. Активные и недавние задачи, а также
              задачи, на которые ссылаются запуски Improve и Lab, останутся.
            </Text>
            <Select
              width="max"
              label="Срок"
              value={[days]}
              options={AGE_OPTIONS}
              onUpdate={(value) => setDays(value[0] ?? '30')}
              disabled={isLoading || removed !== null}
            />
            {removed !== null && <Alert theme="success" view="filled" message={`Удалено: ${removed}`} />}
            {error && <Alert theme="danger" view="filled" message={error} />}
          </Dialog.Body>
          {removed !== null ? (
            <Dialog.Footer textButtonApply="Закрыть" onClickButtonApply={close} />
          ) : (
            <Dialog.Footer
              textButtonCancel="Отмена"
              textButtonApply="Удалить"
              loading={isLoading}
              propsButtonApply={{ view: 'outlined-danger' }}
              onClickButtonCancel={close}
              onClickButtonApply={() => void handleApply()}
            />
          )}
        </Dialog>
      )}
    </>
  );
}
