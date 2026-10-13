import { useState } from 'react';
import { Copy, TriangleExclamation } from '@gravity-ui/icons';
import {
  Alert,
  Button,
  Card,
  ClipboardButton,
  Dialog,
  Icon,
  Skeleton,
  Text,
} from '@gravity-ui/uikit';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { SectionHeader } from '../../widgets/SectionHeader';
import {
  useCreateEmergencyKeyMutation,
  useGetEmergencyKeyQuery,
  useRevokeEmergencyKeyMutation,
} from '../../store/api';
import styles from '../ProfilePage.module.css';

// The way in when neither Yandex nor GitHub works (docs/ha-dr-plan.md §7.5). One key per account; a new one replaces the old.
// The plaintext lives in this component's state only while the dialog is open.
export function EmergencyKeySection() {
  const { data: status, isLoading, isError } = useGetEmergencyKeyQuery();
  const [createKey, { isLoading: isCreating }] = useCreateEmergencyKeyMutation();
  const [revokeKey, { isLoading: isRevoking }] = useRevokeEmergencyKeyMutation();

  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exists = status?.exists === true;

  const handleCreate = async () => {
    setError(null);

    try {
      const created = await createKey().unwrap();
      setIsConfirmOpen(false);
      setCreatedToken(created.token);
    } catch {
      setError('Не удалось создать ключ');
    }
  };

  const handleRevoke = async () => {
    setError(null);

    try {
      await revokeKey().unwrap();
    } catch {
      setError('Не удалось отозвать ключ');
    }
  };

  return (
    <Card view="outlined" className={styles.card}>
      <div className={styles.form}>
        <SectionHeader
          title="Аварийный ключ"
          actions={
            <Button
              view={exists ? 'normal' : 'action'}
              size="s"
              disabled={isLoading || isError}
              onClick={() => (exists ? setIsConfirmOpen(true) : void handleCreate())}
              loading={isCreating && !isConfirmOpen}
            >
              {exists ? 'Заменить' : 'Создать'}
            </Button>
          }
        />

        <Text color="secondary" variant="caption-2">
          Запасной вход на случай, когда недоступны и Яндекс, и GitHub. Ключ показывается один раз — сохраните его в
          менеджере паролей и в офлайн-копии. Вводится на странице входа; каждый вход по нему сразу приходит вам в Telegram.
          Отозвать его можно здесь же.
        </Text>

        {isLoading && <Skeleton width="60%" height={16} />}

        {isError && <Alert theme="danger" view="filled" message="Не удалось загрузить состояние ключа" />}

        {error && <Alert theme="danger" view="filled" message={error} />}

        {!isLoading && !isError && !exists && (
          <Text color="secondary">Ключа ещё нет.</Text>
        )}

        {exists && status && (
          <div className={styles.deviceRow}>
            <span className={styles.deviceIcon}>
              <Icon data={TriangleExclamation} size={16} />
            </span>
            <div className={styles.deviceInfo}>
              <Text>{status.prefix}…</Text>
              <Text color="secondary" variant="caption-2">
                {status.lastUsedAt
                  ? `использован ${formatRelativeTime(status.lastUsedAt)}`
                  : 'ещё не использован'}
              </Text>
            </div>
            <Button view="flat-danger" loading={isRevoking} onClick={() => void handleRevoke()}>
              Отозвать
            </Button>
          </div>
        )}
      </div>

      <Dialog
        open={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        maxWidth="s"
        aria-labelledby="replace-emergency-key-title"
      >
        <Dialog.Header caption="Заменить аварийный ключ?" id="replace-emergency-key-title" />
        <Dialog.Body>
          <Text color="secondary">
            Прежний ключ перестанет работать сразу. Новый будет показан один раз.
          </Text>
        </Dialog.Body>
        <Dialog.Footer
          textButtonCancel="Отмена"
          textButtonApply="Заменить"
          loading={isCreating}
          onClickButtonCancel={() => setIsConfirmOpen(false)}
          onClickButtonApply={() => void handleCreate()}
        />
      </Dialog>

      <Dialog
        open={createdToken !== null}
        onClose={() => setCreatedToken(null)}
        maxWidth="s"
        aria-labelledby="emergency-key-created-title"
      >
        <Dialog.Header caption="Аварийный ключ создан" id="emergency-key-created-title" />
        <Dialog.Body>
          <Text color="secondary">
            Скопируйте ключ сейчас — второй раз он не будет показан. Не храните его только на этом устройстве.
          </Text>
          <div className={styles.endpointRow}>
            <Text variant="code-inline-2" ellipsis title={createdToken ?? ''}>
              {createdToken}
            </Text>
            <ClipboardButton
              text={createdToken ?? ''}
              size="xs"
              view="flat-secondary"
              tooltipInitialText="Скопировать ключ"
              tooltipSuccessText="Скопировано"
            >
              <Icon data={Copy} size={14} />
            </ClipboardButton>
          </div>
        </Dialog.Body>
        <Dialog.Footer textButtonApply="Готово" onClickButtonApply={() => setCreatedToken(null)} />
      </Dialog>
    </Card>
  );
}
