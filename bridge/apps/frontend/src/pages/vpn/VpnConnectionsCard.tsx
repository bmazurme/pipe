import { useState } from 'react';
import { Alert, Button, Card, Skeleton, Text } from '@gravity-ui/uikit';

import { useListVpnConnectionsQuery, VpnConnection, VpnStatus } from '../../store/api';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../VpnPage.module.css';
import { AddConnectionForm } from './AddConnectionForm';
import { VpnConnectionRow } from './VpnConnectionRow';

interface VpnConnectionsCardProps {
  activeStatus?: VpnStatus;
  isActiveStatusLoading: boolean;
  isActiveStatusError: boolean;
  activeStatusErrorReason?: string;
  onSync: () => void;
  isSyncing: boolean;
  syncResult: 'success' | 'error' | null;
}

export function VpnConnectionsCard({
  activeStatus,
  isActiveStatusLoading,
  isActiveStatusError,
  activeStatusErrorReason,
  onSync,
  isSyncing,
  syncResult,
}: VpnConnectionsCardProps) {
  const { data: connections, isLoading, isError } = useListVpnConnectionsQuery();
  const [showAddForm, setShowAddForm] = useState(false);

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader
        title="Доступные VPN"
        actions={
          <Button view="normal" size="s" loading={isSyncing} onClick={onSync}>
            Синхронизировать настройки
          </Button>
        }
      />
      <Text color="secondary" variant="caption-2">
        Активное подключение (ниже) — то, из которого «Синхронизировать настройки» пересобирает
        конфигурацию worker&apos;а и устраняет рассинхронизацию, если настройки сервера менялись
        напрямую через его панель.
      </Text>

      {syncResult === 'success' && (
        <Alert theme="success" view="filled" message="Запущен передеплой worker (~15 минут)." />
      )}
      {syncResult === 'error' && (
        <Alert theme="danger" view="filled" message="Не удалось синхронизировать настройки" />
      )}

      {isLoading && <Skeleton height={40} />}
      {isError && (
        <Alert theme="danger" view="filled" message="Не удалось получить список подключений" />
      )}

      {connections && connections.length > 0 && (
        <ul className={styles.connectionList}>
          {connections.map((connection: VpnConnection) => (
            <VpnConnectionRow
              key={connection.id}
              connection={connection}
              liveStatus={connection.isActive ? activeStatus : undefined}
              isLiveStatusLoading={connection.isActive ? isActiveStatusLoading : undefined}
              isLiveStatusError={connection.isActive ? isActiveStatusError : undefined}
              liveStatusErrorReason={connection.isActive ? activeStatusErrorReason : undefined}
            />
          ))}
        </ul>
      )}

      {!isLoading && connections && connections.length === 0 && (
        <Text color="secondary" variant="body-2">
          Подключений ещё нет — добавьте первое ниже.
        </Text>
      )}

      {showAddForm ? (
        <AddConnectionForm onDone={() => setShowAddForm(false)} />
      ) : (
        <Button view="outlined" onClick={() => setShowAddForm(true)}>
          Новое подключение
        </Button>
      )}
    </Card>
  );
}
