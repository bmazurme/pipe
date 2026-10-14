import { useState } from 'react';
import { TrashBin } from '@gravity-ui/icons';
import {
  Alert, Button, Card, Dialog, DialogBody, DialogFooter, DialogHeader, Icon, Loader, Text,
} from '@gravity-ui/uikit';

import {
  describeApiError,
  useDeleteReportsSettingsBackupMutation,
  useGetReportsSettingsBackupQuery,
} from '../../store/api';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../ReportsPage.module.css';

export function ReportsSettingsBackupSection() {
  const { data: backup, isLoading, isError } = useGetReportsSettingsBackupQuery();
  const [deleteBackup, { isLoading: isDeleting, error: deleteError }] = useDeleteReportsSettingsBackupMutation();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const handleDelete = async () => {
    await deleteBackup();
    setIsConfirmOpen(false);
  };

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader title="Бэкап настроек reports" />

      {isLoading && <Loader size="m" />}
      {isError && <Alert theme="danger" view="filled" message="Не удалось получить статус бэкапа" />}

      {!isLoading && !isError && (
        <div className={styles.row}>
          <Text variant="body-2" color="secondary">
            {backup
              ? `Сохранён ${new Date(backup.updatedAt).toLocaleString('ru-RU')}`
              : 'Бэкап ещё не сохранён — отправьте настройки со страницы Settings в reports'}
          </Text>
          <Button
            view="outlined-danger"
            size="m"
            disabled={!backup}
            onClick={() => setIsConfirmOpen(true)}
            aria-label="Удалить бэкап настроек"
          >
            <Icon data={TrashBin} size={16} />
            Удалить
          </Button>
        </div>
      )}

      {deleteError && <Alert theme="danger" view="filled" message={describeApiError(deleteError)} />}

      <Dialog open={isConfirmOpen} onClose={() => setIsConfirmOpen(false)}>
        <DialogHeader caption="Удалить бэкап настроек?" />
        <DialogBody>
          Последний бэкап настроек reports будет удалён с bridge. Действие нельзя отменить.
        </DialogBody>
        <DialogFooter
          onClickButtonCancel={() => setIsConfirmOpen(false)}
          onClickButtonApply={() => void handleDelete()}
          textButtonApply="Удалить"
          textButtonCancel="Отмена"
          propsButtonApply={{ view: 'outlined-danger', loading: isDeleting }}
        />
      </Dialog>
    </Card>
  );
}
