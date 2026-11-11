import { ChannelsView } from './links';

// What is worth a Telegram message about the channels, as a set of keyed conditions. A condition that holds for a few checks in a row is
// announced once; when it stops holding for a few checks it is announced as over (links-alerts.service.ts). Pure.

export interface DesiredAlert {
  key: string;
  text: string;
  /** Said at once even in quiet hours: the whole pool is gone. */
  urgent: boolean;
  /** What is said when the condition no longer holds. */
  recovered: string;
}

export function desiredAlerts(view: ChannelsView): DesiredAlert[] {
  const alerts: DesiredAlert[] = [];
  const probed = view.channels.filter((channel) => channel.state !== 'unknown');
  const live = view.channels.filter(
    (channel) => channel.state === 'ok' || channel.state === 'partial',
  );
  const nothingReaches = probed.length > 0 && live.length === 0;

  if (nothingReaches) {
    alerts.push({
      key: 'none-reachable',
      text: `🔌 Ни один VPN-канал не доходит ни из одной точки (каналов: ${view.channels.length}). Воркеры и Telegram-прокси остались без выхода.`,
      urgent: true,
      recovered: '✅ VPN-каналы снова доходят',
    });
  } else if (view.channels.length > 1 && live.length === 1) {
    alerts.push({
      key: 'one-left',
      text: `⚠️ Остался один живой VPN-канал: ${live[0].name} (${live[0].key}). Остальные не доходят — пора добавлять запасные.`,
      urgent: false,
      recovered: '✅ Живых VPN-каналов снова больше одного',
    });
  }

  // Per channel only while the pool as a whole still works: with nothing reachable one message already says it.
  if (!nothingReaches) {
    for (const channel of view.channels) {
      if (channel.state === 'down' || channel.state === 'partial') {
        alerts.push({
          key: `channel:${channel.key}`,
          text: `🔌 VPN-канал ${channel.name} (${channel.key}): ${channel.reason ?? 'не доходит'}`,
          urgent: false,
          recovered: `✅ VPN-канал ${channel.name} снова доступен`,
        });
      }
    }
  }

  for (const vantage of view.vantages) {
    if (vantage.stale) {
      alerts.push({
        key: `vantage:${vantage.name}`,
        text: `📡 Точка наблюдения «${vantage.name}» не присылает пробы каналов`,
        urgent: false,
        recovered: `✅ Точка «${vantage.name}» снова присылает пробы`,
      });
    }
  }

  return alerts;
}
