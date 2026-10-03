import { Alert, Card, Select, Text } from '@gravity-ui/uikit';

import { useActivateVpnConnectionMutation, useListVpnConnectionsQuery } from '../../store/api';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../WorkerPage.module.css';

export function VpnConnectionSelector() {
  const { data: connections, isLoading, isError } = useListVpnConnectionsQuery();
  const [activateVpnConnection, { isLoading: isActivating }] = useActivateVpnConnectionMutation();

  const active = connections?.find((connection) => connection.isActive);

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader title="VPN" />
      <Text color="secondary" variant="caption-2">
        Подключение, через которое worker обращается к AI-провайдерам — добавить и проверить
        можно на странице VPN.
      </Text>

      {isError && (
        <Alert theme="danger" view="filled" message="Не удалось получить список VPN-подключений" />
      )}

      <Select
        placeholder="VPN-подключение"
        value={active ? [String(active.id)] : []}
        onUpdate={([value]) => {
          if (value) void activateVpnConnection(Number(value));
        }}
        options={(connections ?? []).map((connection) => ({
          value: String(connection.id),
          content: connection.name,
        }))}
        loading={isLoading || isActivating}
        width="max"
      />
    </Card>
  );
}
