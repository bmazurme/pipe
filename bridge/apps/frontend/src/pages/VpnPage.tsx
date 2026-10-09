import { useState } from 'react';
import { ShieldKeyhole } from '@gravity-ui/icons';

import { describeApiError, useGetVpnStatusQuery, useSyncVpnConfigMutation } from '../store/api';
import { EmptyState } from '../widgets/EmptyState';
import { PageHeader } from '../widgets/PageHeader';
import { ProvisionServerForm } from './vpn/ProvisionServerForm';
import { VpnConnectionsCard } from './vpn/VpnConnectionsCard';
import styles from './VpnPage.module.css';

const STATUS_POLL_INTERVAL_MS = 15000;

export function VpnPage() {
  const { data: status, isLoading, isError, error } = useGetVpnStatusQuery(undefined, {
    pollingInterval: STATUS_POLL_INTERVAL_MS,
    // A background tab has no use for a fresh status, and the poll counts against the per-IP rate limit.
    skipPollingIfUnfocused: true,
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
        activeStatusErrorReason={isError ? describeApiError(error) : undefined}
        onSync={() => void handleSync()}
        isSyncing={isSyncing}
        syncResult={syncResult}
      />

      <ProvisionServerForm />

      {/* Only when there really is no connection — any other failure (panel down, token
          rejected, throttled) used to land here too and read as "nothing configured". */}
      {!isLoading && isError && !status && describeApiError(error).includes('No active VPN connection') && (
        <EmptyState icon={ShieldKeyhole} title="Нет активного VPN-подключения" />
      )}
    </div>
  );
}
