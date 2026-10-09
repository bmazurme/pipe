import { useEffect, useState } from 'react';
import { TrashBin } from '@gravity-ui/icons';
import { Button, Icon, Label, Skeleton, Text, TextInput } from '@gravity-ui/uikit';

import {
  useActivateVpnConnectionMutation,
  useCheckVpnConnectionStatusMutation,
  useDeleteVpnConnectionMutation,
  useGetVpnConnectionLinkMutation,
  VpnConnection,
  VpnStatus,
} from '../../store/api';
import styles from '../VpnPage.module.css';

// How long the armed "delete" button waits for its confirming second click.
const CONFIRM_DELETE_MS = 4000;
import { VpnConnectionStatusGrid } from './VpnConnectionStatusGrid';

interface VpnConnectionRowProps {
  connection: VpnConnection;
  // The active connection's status is already polled every 15s at page
  // level (it's the one card that must never need a manual click to show
  // something) — passed down instead of re-fetching, so this row reuses it
  // rather than duplicating the top-level query and showing two different
  // "Проверить" affordances for the same data.
  liveStatus?: VpnStatus;
  isLiveStatusLoading?: boolean;
  isLiveStatusError?: boolean;
}

export function VpnConnectionRow({
  connection,
  liveStatus,
  isLiveStatusLoading,
  isLiveStatusError,
}: VpnConnectionRowProps) {
  const [activateVpnConnection, { isLoading: isActivating }] = useActivateVpnConnectionMutation();
  const [checkVpnConnectionStatus, { isLoading: isChecking }] = useCheckVpnConnectionStatusMutation();
  const [getVpnConnectionLink, { isLoading: isLinking }] = useGetVpnConnectionLinkMutation();
  const [deleteVpnConnection, { isLoading: isDeleting }] = useDeleteVpnConnectionMutation();

  const [checkedStatus, setCheckedStatus] = useState<VpnStatus | 'error' | null>(null);
  const [link, setLink] = useState<string | 'error' | null>(null);
  const [copied, setCopied] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // An armed delete disarms itself, so a stray earlier click cannot turn a later one into a delete.
  useEffect(() => {
    if (!isConfirmingDelete) return undefined;

    const timer = setTimeout(() => setIsConfirmingDelete(false), CONFIRM_DELETE_MS);

    return () => clearTimeout(timer);
  }, [isConfirmingDelete]);

  const handleActivate = async () => {
    setActionError(null);

    try {
      await activateVpnConnection(connection.id).unwrap();
    } catch {
      setActionError('Не удалось сделать подключение активным');
    }
  };

  const handleDelete = async () => {
    if (!isConfirmingDelete) {
      setIsConfirmingDelete(true);
      return;
    }

    setActionError(null);
    setIsConfirmingDelete(false);

    try {
      await deleteVpnConnection(connection.id).unwrap();
    } catch {
      setActionError('Не удалось удалить подключение');
    }
  };

  const handleCheck = async () => {
    try {
      setCheckedStatus(await checkVpnConnectionStatus(connection.id).unwrap());
    } catch {
      setCheckedStatus('error');
    }
  };

  const handleGetLink = async () => {
    try {
      const result = await getVpnConnectionLink(connection.id).unwrap();
      setLink(result.link);
    } catch {
      setLink('error');
    }
  };

  const handleCopyLink = async () => {
    if (!link || link === 'error') return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  // The active row shows the auto-polled status (always live, nothing to
  // click); any other row shows whatever its own "Проверить" last fetched.
  const status = connection.isActive ? (liveStatus ?? (isLiveStatusError ? 'error' : null)) : checkedStatus;

  return (
    <li className={styles.connectionRow}>
      <div className={styles.connectionHeader}>
        <div className={styles.connectionTitle}>
          <Text variant="body-2">{connection.name}</Text>
          {connection.isActive && (
            <Label theme="success" size="xs">
              Активно
            </Label>
          )}
        </div>
        <div className={styles.connectionActions}>
          {!connection.isActive && (
            <>
              <Button
                view="normal"
                size="s"
                loading={isActivating}
                onClick={() => void handleActivate()}
              >
                Сделать активным
              </Button>
              <Button view="normal" size="s" loading={isChecking} onClick={() => void handleCheck()}>
                Проверить
              </Button>
            </>
          )}
          <Button view="normal" size="s" loading={isLinking} onClick={() => void handleGetLink()}>
            Ссылка
          </Button>
          <Button
            view={isConfirmingDelete ? 'outlined-danger' : 'flat-danger'}
            size="s"
            title={isConfirmingDelete ? 'Нажмите ещё раз для подтверждения' : undefined}
            aria-label={
              isConfirmingDelete
                ? `Подтвердить удаление подключения: ${connection.name}`
                : `Удалить подключение: ${connection.name}`
            }
            loading={isDeleting}
            onClick={() => void handleDelete()}
          >
            <Icon data={TrashBin} size={16} />
            {isConfirmingDelete && 'Удалить?'}
          </Button>
        </div>
      </div>

      {actionError && (
        <Text color="danger" variant="caption-2" role="alert">
          {actionError}
        </Text>
      )}

      {connection.isActive && isLiveStatusLoading && (
        <div className={styles.statGrid}>
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} height={40} />
          ))}
        </div>
      )}

      {status === 'error' && (
        <Text color="danger" variant="caption-2">
          Не удалось получить статус
        </Text>
      )}
      {status && status !== 'error' && <VpnConnectionStatusGrid status={status} />}

      {link === 'error' && (
        <Text color="danger" variant="caption-2">
          Не удалось получить ссылку
        </Text>
      )}
      {link && link !== 'error' && (
        <div className={styles.secretRow}>
          <TextInput value={link} readOnly controlProps={{ 'aria-label': `Ссылка подключения ${connection.name}` }} />
          <Button view="normal" size="s" onClick={() => void handleCopyLink()}>
            {copied ? 'Скопировано' : 'Скопировать'}
          </Button>
        </div>
      )}
    </li>
  );
}
