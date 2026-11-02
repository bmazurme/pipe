// How the router (the ASUS the home link goes through, read over SSH by infra/router on a board) is doing, judged from the agent's report.
// Pure: the service stores the report, this decides what is worth saying.

export type RouterStatus = 'ok' | 'warn' | 'bad';

export interface RouterData {
  // The name the agent gives the router; the row is kept per (account, name).
  host: string;
  // It answers ping from the board.
  reachable: boolean;
  // The agent could log in and read it (false: the key is not accepted, or SSH is off).
  sshOk: boolean;
  model?: string | null;
  uptimeSec?: number | null;
  // nvram wan0_state_t: 2 = connected.
  wanState?: number | null;
  // nvram wan0_auxstate_t: 1 = the cable is not plugged in.
  wanAux?: number | null;
  // nvram link_internet: the router's own check says the internet is there (2).
  internetOk?: boolean | null;
  wanIp?: string | null;
  // Ping from the router itself to a public address.
  pingMs?: number | null;
  pingLossPct?: number | null;
  // Bits per second on the WAN port since the previous report.
  rxBps?: number | null;
  txBps?: number | null;
}

export interface RouterAssessment {
  status: RouterStatus;
  reasons: string[];
}

const MINUTE = 60_000;
// The agent reports every minute (also when the router does not answer): five missed ones is the agent or the board, not the router.
export const ROUTER_STALE_AFTER_MS = 5 * MINUTE;
export const WAN_CONNECTED = 2;
export const WAN_NO_CABLE = 1;
export const PING_WARN_MS = 150;
export const LOSS_WARN_PCT = 20;
export const LOSS_BAD_PCT = 50;
// A router that came up this recently has just rebooted (by itself or by the button): worth a line, not an alarm.
export const JUST_REBOOTED_SEC = 10 * 60;

export function assessRouter(
  data: RouterData,
  reportedAt: Date,
  now: Date = new Date(),
): RouterAssessment {
  const sinceReport = now.getTime() - reportedAt.getTime();

  // Nothing else in the report can be trusted once it is stale.
  if (sinceReport > ROUTER_STALE_AFTER_MS) {
    const hours = Math.floor(sinceReport / (60 * MINUTE));

    return {
      status: 'bad',
      reasons: [
        `Данные о роутере не приходят ${hours >= 1 ? `${hours} ч` : `${Math.round(sinceReport / MINUTE)} мин`} — агент на плате не работает`,
      ],
    };
  }

  if (!data.reachable) {
    return {
      status: 'bad',
      reasons: ['Роутер не отвечает на ping с платы'],
    };
  }

  const bad: string[] = [];
  const warn: string[] = [];

  if (!data.sshOk) {
    warn.push('Роутер отвечает, но прочитать его по SSH не удалось (ключ?)');
  } else {
    if (data.wanAux === WAN_NO_CABLE) {
      bad.push('Кабель провайдера не подключён к WAN');
    } else if (data.wanState != null && data.wanState !== WAN_CONNECTED) {
      bad.push(`WAN не подключён (состояние ${data.wanState})`);
    } else if (data.internetOk === false) {
      bad.push('WAN подключён, но интернета нет');
    }

    if ((data.pingLossPct ?? 0) >= LOSS_BAD_PCT) {
      bad.push(`Потеряно ${data.pingLossPct} % пакетов до внешнего адреса`);
    } else if ((data.pingLossPct ?? 0) >= LOSS_WARN_PCT) {
      warn.push(`Потеряно ${data.pingLossPct} % пакетов до внешнего адреса`);
    }
    if ((data.pingMs ?? 0) >= PING_WARN_MS) {
      warn.push(`Задержка до внешнего адреса ${Math.round(data.pingMs!)} мс`);
    }
    if (data.uptimeSec != null && data.uptimeSec < JUST_REBOOTED_SEC) {
      warn.push(
        `Роутер перезагрузился ${Math.max(1, Math.round(data.uptimeSec / 60))} мин назад`,
      );
    }
  }

  return {
    status: bad.length ? 'bad' : warn.length ? 'warn' : 'ok',
    reasons: [...bad, ...warn],
  };
}
