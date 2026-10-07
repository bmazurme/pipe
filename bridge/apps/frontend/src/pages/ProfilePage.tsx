import { FormEvent, useState } from 'react';
import { LogoYandex } from '@gravity-ui/icons';
import {
  Alert,
  Avatar,
  Button,
  Card,
  ClipboardButton,
  Icon,
  Label,
  Link,
  Text,
  TextInput,
} from '@gravity-ui/uikit';

import { useAuth } from '../app/providers/AuthProvider';
import { getInitial } from '../shared/ui/InitialIcon';
import { PageHeader } from '../widgets/PageHeader';
import { API_URL, getErrorMessage, useUpdateUserMutation } from '../store/api';
import { ApiKeysSection } from './profile/ApiKeysSection';
import { DevicesSection } from './profile/DevicesSection';
import { LogsSection } from './profile/LogsSection';
import { NotificationsSection } from './profile/NotificationsSection';
import styles from './ProfilePage.module.css';

const DAY_OFFS_EXPORT_URL = `${API_URL}/api/v1/time/export/day-offs?year=${new Date().getFullYear()}`;

const MAX_STATUS_LENGTH = 140;
/** Show the counter only once the limit is actually in play. */
const COUNTER_THRESHOLD = MAX_STATUS_LENGTH - 40;

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

  const savedStatus = user.status ?? '';
  const isDirty = status !== savedStatus;
  const isTooLong = status.length > MAX_STATUS_LENGTH;

  const handleChange = (value: string) => {
    setStatus(value);
    // Any edit invalidates the previous result — keeping a stale "Сохранено"
    // next to unsaved text is worse than showing nothing.
    setIsSaved(false);
    setError(null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (!isDirty || isTooLong) {
      return;
    }

    setIsSaving(true);
    setError(null);
    setIsSaved(false);

    try {
      await updateUser({ id: user.id, status }).unwrap();
      await refreshUser();
      setIsSaved(true);
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось сохранить изменения'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={styles.page}>
      <PageHeader title="Профиль" description="Учётная запись и активные сеансы" />

      <div className={styles.grid}>
        <div className={styles.column}>
          <Card view="outlined" className={styles.card}>
            <div className={styles.identity}>
              <Avatar text={getInitial(user.username)} size="l" theme="brand" />
              <div className={styles.identityInfo}>
                <Text variant="subheader-2" ellipsis title={user.username}>
                  {user.username}
                </Text>
                <div className={styles.identityMeta}>
                  <Label theme="normal" size="xs" icon={<Icon data={LogoYandex} size={12} />}>
                    Яндекс ID
                  </Label>
                  <ClipboardButton
                    text={user.username}
                    size="xs"
                    view="flat-secondary"
                    tooltipInitialText="Скопировать email"
                    tooltipSuccessText="Скопировано"
                  />
                </div>
              </div>
            </div>
          </Card>

          <Card view="outlined" className={styles.card}>
            {/* A real <form> so Enter submits from the field, the way every
                other single-input settings form behaves. */}
            <form className={styles.form} onSubmit={(e) => void handleSubmit(e)}>
              <Text variant="subheader-2" as="h2" className={styles.cardTitle}>
                О себе
              </Text>

              {/* Wrapping <label> associates the caption with the control
                  natively — no id plumbing, and the caption is clickable. */}
              <label className={styles.field}>
                <Text variant="body-2" color="secondary">
                  Статус
                </Text>
                <TextInput
                  value={status}
                  onUpdate={handleChange}
                  placeholder="Расскажите о себе"
                  size="l"
                  hasClear
                  disabled={isSaving}
                  validationState={isTooLong ? 'invalid' : undefined}
                  errorMessage={
                    isTooLong ? `Не длиннее ${MAX_STATUS_LENGTH} символов` : undefined
                  }
                  note={
                    status.length >= COUNTER_THRESHOLD
                      ? `${status.length} / ${MAX_STATUS_LENGTH}`
                      : undefined
                  }
                />
              </label>

              {error && <Alert theme="danger" view="filled" message={error} />}
              {isSaved && !isDirty && (
                <Alert theme="success" view="filled" message="Изменения сохранены" />
              )}

              <div className={styles.actions}>
                <Button
                  type="submit"
                  view="action"
                  size="l"
                  disabled={!isDirty || isTooLong}
                  loading={isSaving}
                >
                  Сохранить
                </Button>
                {/* Only offered once there is something to undo. */}
                {isDirty && (
                  <Button
                    type="button"
                    view="flat"
                    size="l"
                    disabled={isSaving}
                    onClick={() => handleChange(savedStatus)}
                  >
                    Отменить
                  </Button>
                )}
              </div>
            </form>
          </Card>

          <Card view="outlined" className={styles.card}>
            <div className={styles.form}>
              <Text variant="subheader-2" as="h2" className={styles.cardTitle}>
                Интеграции
              </Text>
              <Text color="secondary" variant="body-2">
                Эндпоинт для импорта дней отдыха в{' '}
                <Link
                  href="https://github.com/bmazurme/ntlstl.time"
                  target="_blank"
                  rel="noreferrer"
                >
                  ntlstl.time
                </Link>
                . Запрос должен нести заголовок <code>X-Api-Key</code> со значением{' '}
                <code>TIME_EXPORT_API_KEY</code>, заданным на сервере.
              </Text>
              <div className={styles.endpointRow}>
                <Text variant="code-inline-2" ellipsis title={DAY_OFFS_EXPORT_URL}>
                  {DAY_OFFS_EXPORT_URL}
                </Text>
                <ClipboardButton
                  text={DAY_OFFS_EXPORT_URL}
                  size="xs"
                  view="flat-secondary"
                  tooltipInitialText="Скопировать ссылку"
                  tooltipSuccessText="Скопировано"
                />
              </div>
            </div>
          </Card>
        </div>

        <div className={styles.column}>
          <NotificationsSection />
          <DevicesSection />
          <ApiKeysSection />
          <LogsSection />
        </div>
      </div>
    </div>
  );
}
