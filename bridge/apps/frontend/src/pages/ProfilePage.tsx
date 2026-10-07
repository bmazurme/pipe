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
  Tab,
  TabList,
  TabPanel,
  TabProvider,
  Text,
  TextInput,
} from '@gravity-ui/uikit';

import { useAuth } from '../app/providers/AuthProvider';
import { getInitial } from '../shared/ui/InitialIcon';
import { PageHeader } from '../widgets/PageHeader';
import { useTabParam } from '../shared/hooks/useTabParam';
import { getErrorMessage, useUpdateUserMutation } from '../store/api';
import { ApiKeysSection } from './profile/ApiKeysSection';
import { DevicesSection } from './profile/DevicesSection';
import { LogsSection } from './profile/LogsSection';
import { NotificationsSection } from './profile/NotificationsSection';
import styles from './ProfilePage.module.css';

const TABS = ['account', 'access', 'logs'] as const;

const MAX_STATUS_LENGTH = 140;
/** Show the counter only once the limit is actually in play. */
const COUNTER_THRESHOLD = MAX_STATUS_LENGTH - 40;

export function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const [activeTab, setActiveTab] = useTabParam(TABS, 'account');
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
      <PageHeader title="Профиль" description="Учётная запись, уведомления, доступ и логи" />

      <TabProvider value={activeTab} onUpdate={setActiveTab}>
        <TabList>
          <Tab value="account">Аккаунт</Tab>
          <Tab value="access">Доступ</Tab>
          <Tab value="logs">Логи</Tab>
        </TabList>

        {/* Only the active panel is rendered: TabPanel merely hides the others
            with CSS, and the sessions/keys/logs requests should not fire for a
            tab nobody opened. */}
        <TabPanel value="account">
          {activeTab === 'account' && (
            <div className={styles.panel}>
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

                {/* A real <form> so Enter submits from the field, the way every
                    other single-input settings form behaves. */}
                <form className={styles.statusForm} onSubmit={(e) => void handleSubmit(e)}>
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

                  {/* Appears only when there is something to save or undo. */}
                  {isDirty && (
                    <div className={styles.actions}>
                      <Button type="submit" view="action" size="l" disabled={isTooLong} loading={isSaving}>
                        Сохранить
                      </Button>
                      <Button
                        type="button"
                        view="flat"
                        size="l"
                        disabled={isSaving}
                        onClick={() => handleChange(savedStatus)}
                      >
                        Отменить
                      </Button>
                    </div>
                  )}
                </form>
              </Card>

              <NotificationsSection />
            </div>
          )}
        </TabPanel>

        <TabPanel value="access">
          {activeTab === 'access' && (
            <div className={styles.panel}>
              <ApiKeysSection />
              <DevicesSection />
            </div>
          )}
        </TabPanel>

        <TabPanel value="logs">{activeTab === 'logs' && <div className={styles.panel}><LogsSection /></div>}</TabPanel>
      </TabProvider>
    </div>
  );
}
