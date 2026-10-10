import { useEffect, useState } from 'react';
import { ShieldKeyhole } from '@gravity-ui/icons';

import { describeApiError, useGetVpnStatusQuery, useSyncVpnConfigMutation } from '../store/api';
import { EmptyState } from '../widgets/EmptyState';
import { PageHeader } from '../widgets/PageHeader';
import { ProvisionServerForm } from './vpn/ProvisionServerForm';
import { VpnConnectionsCard } from './vpn/VpnConnectionsCard';
import { nextPollInterval } from './vpn/statusPollInterval';
import styles from './VpnPage.module.css';

export function VpnPage() {
  const [lastRequestFailed, setLastRequestFailed] = useState(false);
  const { data: status, isLoading, isError, isSuccess, isFetching, error } = useGetVpnStatusQuery(undefined, {
    pollingInterval: nextPollInterval(lastRequestFailed),
    // A background tab has no use for a fresh status, and the poll counts against the per-IP rate limit.
    skipPollingIfUnfocused: true,
  });
  // isError drops back to false while a retry is in flight, so remember the last settled result instead.
  useEffect(() => {
    if (isError) setLastRequestFailed(true);
    else if (isSuccess && !isFetching) setLastRequestFailed(false);
  }, [isError, isSuccess, isFetching]);
  const [syncVpnConfig, { isLoading: isSyncing }] = useSyncVpnConfigMutation();
  const [syncResult, setSyncResult] = useState<'success' | 'error' | null>(null);

  const isNoActiveConnection = isError && (error as { status?: unknown } | undefined)?.status === 404;

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
      {!isLoading && isError && !status && isNoActiveConnection && (
        <EmptyState
          icon={ShieldKeyhole}
          title="Нет активного VPN-подключения"
          description="Добавьте подключение ниже"
        />
      )}
    </div>
  );
}
