import { useState } from 'react';
import { ShieldKeyhole } from '@gravity-ui/icons';

import { useGetVpnStatusQuery, useSyncVpnConfigMutation } from '../store/api';
import { EmptyState } from '../widgets/EmptyState';
import { PageHeader } from '../widgets/PageHeader';
import { ProvisionServerForm } from './vpn/ProvisionServerForm';
import { VpnConnectionsCard } from './vpn/VpnConnectionsCard';
import styles from './VpnPage.module.css';

const STATUS_POLL_INTERVAL_MS = 15000;

export function VpnPage() {
  const { data: status, isLoading, isError } = useGetVpnStatusQuery(undefined, {
    pollingInterval: STATUS_POLL_INTERVAL_MS,
  });
  const [syncVpnConfig, { isLoading: isSyncing }] = useSyncVpnConfigMutation();
  const [syncResult, setSyncResult] = useState<'success' | 'error' | null>(null);

  const handleSync = async () => {
    setSyncResult(null);
    try {
      await syncVpnConfig().unwrap();
      setSyncResult('success');
    } catch {
      setSyncResult('error');
    }
  };

  return (
    <div className={styles.page}>
      <PageHeader
        title="VPN"
        description="Статус туннеля, через который worker обращается к AI-провайдерам, и его настройка."
      />

      <VpnConnectionsCard
        activeStatus={status}
        isActiveStatusLoading={isLoading}
        isActiveStatusError={isError}
        onSync={() => void handleSync()}
        isSyncing={isSyncing}
        syncResult={syncResult}
      />

      <ProvisionServerForm />

      {!isLoading && isError && !status && (
        <EmptyState icon={ShieldKeyhole} title="Нет активного VPN-подключения" />
      )}
    </div>
  );
}
