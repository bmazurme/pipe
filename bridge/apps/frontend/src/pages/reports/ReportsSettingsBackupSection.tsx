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
  const [deleteBackup, { isLoading: isDeleting }] = useDeleteReportsSettingsBackupMutation();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const openConfirm = () => {
    setDeleteError(null);
    setIsConfirmOpen(true);
  };

  const handleDelete = async () => {
    try {
      await deleteBackup().unwrap();
      setIsConfirmOpen(false);
    } catch (err) {
      setDeleteError(describeApiError(err));
    }
  };

  const savedAt = backup ? new Date(backup.updatedAt) : null;
  const savedAtText = savedAt && !Number.isNaN(savedAt.getTime()) ? savedAt.toLocaleString('ru-RU') : null;

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader title="Бэкап настроек reports" />

      {isLoading && <Loader size="m" />}
      {isError && <Alert theme="danger" view="filled" message="Не удалось получить статус бэкапа" />}

      {!isLoading && !isError && (
        <div className={styles.row}>
          <Text variant="body-2" color="secondary">
            {backup
              ? (savedAtText ? `Сохранён ${savedAtText}` : 'Бэкап сохранён')
              : 'Бэкап ещё не сохранён — отправьте настройки со страницы Settings в reports'}
          </Text>
          <Button
            view="outlined-danger"
            size="m"
            disabled={!backup}
            onClick={openConfirm}
            aria-label="Удалить бэкап настроек"
          >
            <Icon data={TrashBin} size={16} />
            Удалить
          </Button>
        </div>
      )}

      <Dialog open={isConfirmOpen} onClose={() => setIsConfirmOpen(false)}>
        <DialogHeader caption="Удалить бэкап настроек?" />
        <DialogBody>
          Последний бэкап настроек reports будет удалён с bridge. Действие нельзя отменить.
          {deleteError && <Alert theme="danger" view="filled" message={deleteError} />}
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
