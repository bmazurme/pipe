import { useState } from 'react';
import { Button, Card, Text, TextInput } from '@gravity-ui/uikit';

import { useAuth } from '../app/providers/AuthProvider';
import { useUpdateUserMutation } from '../store/api';
import { DevicesSection } from './profile/DevicesSection';
import styles from './ProfilePage.module.css';

export function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const [updateUser] = useUpdateUserMutation();
  const [status, setStatus] = useState(user?.status ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);

  if (!user) {
    return null;
  }

  const isDirty = status !== (user.status ?? '');

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setIsSaved(false);

    try {
      await updateUser({ id: user.id, status }).unwrap();
      await refreshUser();
      setIsSaved(true);
    } catch {
      setError('Не удалось сохранить изменения');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div>
      <Text variant="header-1" as="h1">
        Профиль
      </Text>

      <Card view="outlined" className={styles.card}>
        <div className={styles.form}>
          <div>
            <Text variant="subheader-1" as="div">
              Email
            </Text>
            <div className={styles.fieldValue}>
              <Text color="secondary">{user.username}</Text>
            </div>
          </div>

          <div>
            <Text variant="subheader-1" as="div">
              Статус
            </Text>
            <div className={styles.fieldValue}>
              <TextInput
                value={status}
                onUpdate={setStatus}
                placeholder="Расскажите о себе"
                size="l"
              />
            </div>
          </div>

          {error && <Text color="danger">{error}</Text>}
          {isSaved && !isDirty && <Text color="positive">Сохранено</Text>}

          <Button
            view="action"
            size="l"
            width="max"
            disabled={!isDirty}
            loading={isSaving}
            onClick={() => void handleSave()}
          >
            Сохранить
          </Button>
        </div>
      </Card>

      <DevicesSection />
    </div>
  );
}
