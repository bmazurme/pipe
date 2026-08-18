import { useState } from 'react';
import { TrashBin } from '@gravity-ui/icons';
import { Button, Card, Icon, Loader, Text } from '@gravity-ui/uikit';

import { parseUserAgent } from '../../shared/lib/parseUserAgent';
import { Session, useListSessionsQuery, useRevokeSessionMutation } from '../../store/api';
import { useAppSelector } from '../../store/hooks';
import { sessionsSelector } from '../../store/slices';
import styles from '../ProfilePage.module.css';

function formatDate(value: string): string {
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function DevicesSection() {
  const { isLoading, isError } = useListSessionsQuery();
  const sessions = useAppSelector(sessionsSelector);
  const [revokeSession] = useRevokeSessionMutation();
  const [revokingId, setRevokingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRevoke = async (session: Session) => {
    setError(null);
    setRevokingId(session.id);

    try {
      await revokeSession(session.id).unwrap();
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

        {(error || isError) && (
          <Text color="danger">
            {error ?? 'Не удалось загрузить список устройств'}
          </Text>
        )}

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
