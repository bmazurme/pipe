import { useEffect, useState } from 'react';
import { TrashBin } from '@gravity-ui/icons';
import { Button, Card, Icon, Loader, Text, TextInput } from '@gravity-ui/uikit';

import { useAuth } from '../app/providers/AuthProvider';
import { listSessions, revokeSession, Session } from '../shared/api/sessions';
import { updateUser } from '../shared/api/users';
import { parseUserAgent } from '../shared/lib/parseUserAgent';
import styles from './ProfilePage.module.css';

function formatDate(value: string): string {
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function DevicesSection() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const result = await listSessions();
        if (!cancelled) setSessions(result);
      } catch {
        if (!cancelled) setError('Не удалось загрузить список устройств');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleRevoke = async (session: Session) => {
    setError(null);
    setRevokingId(session.id);

    try {
      await revokeSession(session.id);
      setSessions((prev) => prev.filter((item) => item.id !== session.id));
    } catch {
      setError('Не удалось завершить сеанс');
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <Card view="outlined" className={styles.card}>
      <div className={styles.form}>
        <Text variant="subheader-1" as="div">
          Устройства
        </Text>

        {isLoading && (
          <div className={styles.centered}>
            <Loader size="m" />
          </div>
        )}

        {error && <Text color="danger">{error}</Text>}

        {!isLoading && sessions.length > 0 && (
          <ul className={styles.deviceList}>
            {sessions.map((session) => (
              <li key={session.id} className={styles.deviceRow}>
                <div className={styles.deviceInfo}>
                  <Text>
                    {parseUserAgent(session.userAgent)}
                    {session.isCurrent && (
                      <Text color="positive"> · Текущее устройство</Text>
                    )}
                  </Text>
                  <Text color="secondary">
                    Активность:{' '}
                    {formatDate(session.lastUsedAt ?? session.createdAt)}
                  </Text>
                </div>
                {!session.isCurrent && (
                  <Button
                    view="flat-danger"
                    title="Завершить сеанс"
                    aria-label="Завершить сеанс"
                    loading={revokingId === session.id}
                    onClick={() => void handleRevoke(session)}
                  >
                    <Icon data={TrashBin} size={16} />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export function ProfilePage() {
  const { user, refreshUser } = useAuth();
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
      await updateUser(user.id, { status });
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
