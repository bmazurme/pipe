import { Label, Text } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { VpnStatus } from '../../store/api';
import styles from '../VpnPage.module.css';
import { formatBytes } from './formatBytes';

// Worker's last claim (see vpn-client's own Reality handshake) is the only
// heartbeat there is — no separate liveness ping exists, so "connected"
// here means "connected recently", not "connected right now".
const RECENT_THRESHOLD_MS = 5 * 60 * 1000;

export function VpnConnectionStatusGrid({ status }: { status: VpnStatus }) {
  const isRecent = status.lastOnline
    ? Date.now() - new Date(status.lastOnline).getTime() < RECENT_THRESHOLD_MS
    : false;

  return (
    <div className={styles.statGrid}>
      <div className={styles.stat}>
        <Text color="secondary" variant="caption-2">
          Соединение
        </Text>
        <Label theme={isRecent ? 'success' : 'normal'}>
          {status.lastOnline
            ? `${isRecent ? 'активно' : 'было'} · ${formatRelativeTime(status.lastOnline)}`
            : 'ещё не подключалось'}
        </Label>
      </div>
      <div className={styles.stat}>
        <Text color="secondary" variant="caption-2">
          Трафик
        </Text>
        <Text variant="body-2">
          ↑ {formatBytes(status.upBytes)} · ↓ {formatBytes(status.downBytes)}
        </Text>
      </div>
      <div className={styles.stat}>
        <Text color="secondary" variant="caption-2">
          SNI
        </Text>
        <Text variant="body-2">{status.sni}</Text>
      </div>
      <div className={styles.stat}>
        <Text color="secondary" variant="caption-2">
          Порт
        </Text>
        <Text variant="body-2">{status.port}</Text>
      </div>
    </div>
  );
}
