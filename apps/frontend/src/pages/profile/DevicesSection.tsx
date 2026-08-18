import { useState } from 'react';
import { Display, Globe, Smartphone, TrashBin } from '@gravity-ui/icons';
import {
  ActionTooltip,
  Alert,
  Button,
  Card,
  Dialog,
  Icon,
  Label,
  Skeleton,
  Text,
} from '@gravity-ui/uikit';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { EmptyState } from '../../widgets/EmptyState';
import { SectionHeader } from '../../widgets/SectionHeader';
import { DeviceKind, getDeviceKind, parseUserAgent } from '../../shared/lib/parseUserAgent';
import { Session, useListSessionsQuery, useRevokeSessionMutation } from '../../store/api';
import { useAppSelector } from '../../store/hooks';
import { sessionsSelector } from '../../store/slices';
import styles from '../ProfilePage.module.css';

const KIND_ICON: Record<DeviceKind, typeof Display> = {
  mobile: Smartphone,
  // No dedicated tablet glyph in the icon set — a display reads closer than a
  // phone for the larger form factor.
  tablet: Display,
  desktop: Display,
  unknown: Globe,
};

const SKELETON_ROWS = [0, 1, 2];

export function DevicesSection() {
  const { isLoading, isError } = useListSessionsQuery();
  const sessions = useAppSelector(sessionsSelector);
  const [revokeSession] = useRevokeSessionMutation();
  const [revokingId, setRevokingId] = useState<number | null>(null);
  const [isRevokingAll, setIsRevokingAll] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const otherSessions = sessions.filter((session) => !session.isCurrent);

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

  const handleRevokeAll = async () => {
    setError(null);
    setIsRevokingAll(true);

    // allSettled, not all: one failing revoke shouldn't hide the ones that
    // did go through — the list refreshes either way.
    const results = await Promise.allSettled(
      otherSessions.map((session) => revokeSession(session.id).unwrap()),
    );

    if (results.some((result) => result.status === 'rejected')) {
      setError('Не удалось завершить часть сеансов');
    }

    setIsRevokingAll(false);
    setIsConfirmOpen(false);
  };

  const isBusy = isRevokingAll || revokingId !== null;

  return (
    <Card view="outlined" className={styles.card}>
      <div className={styles.form}>
        <SectionHeader
          title="Устройства"
          meta={sessions.length > 0 ? String(sessions.length) : undefined}
          actions={
            otherSessions.length > 0 && (
              <Button
                view="flat-danger"
                size="s"
                disabled={isBusy}
                onClick={() => setIsConfirmOpen(true)}
              >
                Завершить остальные
              </Button>
            )
          }
        />

        <Text color="secondary" variant="caption-2">
          Здесь видно, где выполнен вход. Завершите сеанс, если не узнаёте
          устройство.
        </Text>

        {isLoading && (
          <ul className={styles.deviceList}>
            {SKELETON_ROWS.map((row) => (
              <li key={row} className={styles.deviceRow}>
                <Skeleton
                  variant="circle"
                  width={32}
                  height={32}
                  className={styles.deviceIconSkeleton}
                />
                <div className={styles.deviceInfo}>
                  <Skeleton width="60%" height={16} />
                  <Skeleton width="40%" height={12} />
                </div>
              </li>
            ))}
          </ul>
        )}

        {(error || isError) && (
          <Alert
            theme="danger"
            view="filled"
            message={error ?? 'Не удалось загрузить список устройств'}
          />
        )}

        {!isLoading && !isError && sessions.length === 0 && (
          <EmptyState icon={Globe} title="Активных сеансов нет" />
        )}

        {!isLoading && sessions.length > 0 && (
          <ul className={styles.deviceList}>
            {sessions.map((session) => (
              <li key={session.id} className={styles.deviceRow}>
                <span className={styles.deviceIcon}>
                  <Icon data={KIND_ICON[getDeviceKind(session.userAgent)]} size={16} />
                </span>

                <div className={styles.deviceInfo}>
                  <div className={styles.deviceTitle}>
                    <Text ellipsis title={session.userAgent ?? undefined}>
                      {parseUserAgent(session.userAgent)}
                    </Text>
                    {session.isCurrent && (
                      <Label theme="success" size="xs">
                        Это устройство
                      </Label>
                    )}
                  </div>
                  <Text color="secondary" variant="caption-2" ellipsis>
                    {formatRelativeTime(session.lastUsedAt ?? session.createdAt)}
                    {session.ip ? ` · ${session.ip}` : ''}
                  </Text>
                </div>

                {!session.isCurrent && (
                  <ActionTooltip title="Завершить сеанс">
                    <Button
                      view="flat-danger"
                      aria-label={`Завершить сеанс: ${parseUserAgent(session.userAgent)}`}
                      disabled={isBusy && revokingId !== session.id}
                      loading={revokingId === session.id}
                      onClick={() => void handleRevoke(session)}
                    >
                      <Icon data={TrashBin} size={16} />
                    </Button>
                  </ActionTooltip>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog
        open={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        maxWidth="s"
        aria-labelledby="revoke-all-title"
      >
        <Dialog.Header caption="Завершить остальные сеансы?" id="revoke-all-title" />
        <Dialog.Body>
          <Text color="secondary">
            Выход произойдёт на {otherSessions.length}{' '}
            {otherSessions.length === 1 ? 'устройстве' : 'устройствах'}. Текущее
            устройство останется в системе.
          </Text>
        </Dialog.Body>
        <Dialog.Footer
          preset="danger"
          loading={isRevokingAll}
          textButtonCancel="Отмена"
          textButtonApply="Завершить"
          onClickButtonCancel={() => setIsConfirmOpen(false)}
          onClickButtonApply={() => void handleRevokeAll()}
        />
      </Dialog>
    </Card>
  );
}
