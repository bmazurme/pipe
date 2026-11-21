import { Card, Label, Text } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { useGetBridgeTunnelQuery } from '../../store/api';
import styles from '../VpnPage.module.css';

const POLL_MS = 30_000;

// bridge's own way out: an Xray client built from the ACTIVE connection above, which Telegram (alerts, the bot, the channel) and GitHub use
// while it works. Without it they would go through a client configured once when the stack was deployed.
export function BridgeTunnelCard() {
  const { data } = useGetBridgeTunnelQuery(undefined, { pollingInterval: POLL_MS, skipPollingIfUnfocused: true });

  // Not loaded yet, or an older bridge without the route: nothing to say.
  if (!data || (data.mode !== 'on' && data.mode !== 'off')) return null;

  const state =
    data.mode === 'off'
      ? { theme: 'normal' as const, text: 'выключен' }
      : data.inUse
        ? { theme: 'success' as const, text: 'работает' }
        : { theme: 'warning' as const, text: 'не используется' };

  return (
    <Card view="outlined" className={styles.tunnelCard}>
      <div className={styles.tunnelHead}>
        <Text variant="subheader-2">Туннель bridge</Text>
        <Label theme={state.theme} size="s">
          {state.text}
        </Label>
      </div>
      <Text variant="body-1" color="secondary">
        {data.mode === 'off'
          ? `${data.reason ?? 'Туннель выключен'}: Telegram и GitHub идут через прокси из окружения.`
          : data.inUse
            ? `Telegram и GitHub идут через активное подключение (ссылок: ${data.links}).`
            : data.links === 0
              ? 'Нет активного подключения: Telegram и GitHub идут через прокси из окружения.'
              : 'Туннель поднят, но Telegram через него не отвечает: используется прокси из окружения.'}
      </Text>
      {data.checks.length > 0 && (
        <ul className={styles.tunnelChecks}>
          {data.checks.map((check) => (
            <li key={check.key}>
              <Label theme={check.ok ? 'success' : 'danger'} size="xs">
                {check.ok ? 'ок' : 'нет'}
              </Label>{' '}
              {check.label}
              <Text variant="caption-2" color="secondary">
                {check.ok ? ` ${check.ms} мс` : ` ${check.error ?? ''}`}
              </Text>
            </li>
          ))}
        </ul>
      )}
      {data.since && (
        <Text variant="caption-2" color="secondary">
          Состояние с {formatRelativeTime(data.since)}
        </Text>
      )}
      {data.telegram?.down && (
        <Text variant="body-1" color="danger">
          Telegram недоступен{data.telegram.since ? ` с ${formatRelativeTime(data.telegram.since)}` : ''}
          {data.telegram.error ? `: ${data.telegram.error}` : ''}
        </Text>
      )}
      {data.fallback &&
        (data.fallback.configured ? (
          <Text variant="caption-2" color="secondary">
            Запасной канал для срочных алертов: {data.fallback.channels.map((channel) => `${channel.name === 'email' ? 'почта' : 'webhook'} (${channel.target})`).join(', ')}.
          </Text>
        ) : (
          <Text variant="caption-2" color="warning">
            Запасной канал не настроен: если Telegram недоступен, алерты не дойдут (ALERT_WEBHOOK_URL или ALERT_SMTP_URL + ALERT_EMAIL_TO).
          </Text>
        ))}
    </Card>
  );
}
