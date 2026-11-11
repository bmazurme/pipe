// How the channels (the VPN servers a tunnel can go out through) are doing, judged from probes made from several places. Pure: the
// service stores the probes, this decides what is worth saying. A channel is a host:port a link of some connection points at; a probe
// is made from one vantage point (bridge itself, a Pi at home, the cloud VM, a laptop, a beacon in another network) and says how far a
// connection got — so "blocked from home but fine from the cloud" (what happened to 95.81.127.173) is visible, not guessed.

export type ProbeResult =
  | 'ok'
  | 'tcp_timeout'
  | 'tcp_refused'
  | 'tls_timeout'
  | 'tls_reset'
  | 'tls_error'
  | 'error';

export const PROBE_RESULTS: ProbeResult[] = [
  'ok',
  'tcp_timeout',
  'tcp_refused',
  'tls_timeout',
  'tls_reset',
  'tls_error',
  'error',
];

// What each failure usually means on the way to a VPN server; wording kept short, it goes into a tile and a Telegram line.
export const RESULT_TEXT: Record<ProbeResult, string> = {
  ok: 'доступен',
  tcp_timeout: 'нет ответа на SYN (порт или адрес отфильтрован)',
  tcp_refused: 'порт закрыт (RST на SYN)',
  tls_timeout: 'соединение есть, дальше тишина (тротлинг?)',
  tls_reset: 'сброс после рукопожатия (DPI?)',
  tls_error: 'ошибка TLS',
  error: 'ошибка соединения',
};

export interface Channel {
  /** host:port — what probes are keyed by. */
  key: string;
  /** The connection's name, numbered when its pool has several links. */
  name: string;
  host: string;
  port: number;
  /** The SNI of the Reality link: the handshake is made with it, as a client would. */
  sni: string;
}

export interface ProbeRow {
  vantage: string;
  channelKey: string;
  result: ProbeResult;
  tcpMs: number | null;
  tlsMs: number | null;
  detail: string | null;
  probedAt: Date;
  /** When the result last changed (so "blocked since …" is known). */
  changedAt: Date;
}

export interface ProbeCell {
  vantage: string;
  result: ProbeResult;
  tcpMs: number | null;
  tlsMs: number | null;
  detail: string | null;
  probedAt: string;
  changedAt: string;
  /** A probe older than STALE_AFTER_MS says nothing about now. */
  stale: boolean;
}

export type ChannelState = 'ok' | 'partial' | 'down' | 'unknown';

export interface ChannelView extends Channel {
  state: ChannelState;
  cells: ProbeCell[];
  /** Why it is not ok, in words; null when it is. */
  reason: string | null;
}

export interface VantageView {
  name: string;
  lastProbeAt: string;
  stale: boolean;
}

export type ChannelsStatus = 'ok' | 'warn' | 'bad';

export interface ChannelsView {
  status: ChannelsStatus;
  reasons: string[];
  channels: ChannelView[];
  vantages: VantageView[];
}

const MINUTE = 60_000;
// Probes come every minute: five missed ones is a vantage point that is off, cut off or whose agent died.
export const STALE_AFTER_MS = 5 * MINUTE;

// What a failed connection attempt was, from how far it got (`stage`) and the error. `timedOut` is our own timer, which says the same as
// ETIMEDOUT: the packets went out and nothing came back.
export function classifyFailure(
  stage: 'tcp' | 'tls',
  error: { code?: string; message?: string } | undefined,
  timedOut: boolean,
): { result: ProbeResult; detail: string | null } {
  const code = error?.code;
  const detail = code ?? error?.message?.slice(0, 120) ?? null;

  if (stage === 'tcp') {
    if (timedOut || code === 'ETIMEDOUT')
      return { result: 'tcp_timeout', detail };
    if (code === 'ECONNREFUSED') return { result: 'tcp_refused', detail };

    return { result: 'error', detail };
  }

  if (timedOut || code === 'ETIMEDOUT')
    return { result: 'tls_timeout', detail };
  if (code === 'ECONNRESET' || code === 'EPIPE')
    return { result: 'tls_reset', detail };

  return { result: 'tls_error', detail };
}

const list = (names: string[]) => names.join(', ');

export function assessChannels(
  channels: Channel[],
  probes: ProbeRow[],
  now: Date = new Date(),
): ChannelsView {
  const isStale = (at: Date) => now.getTime() - at.getTime() > STALE_AFTER_MS;
  const known = new Set(channels.map((channel) => channel.key));
  const mine = probes.filter((probe) => known.has(probe.channelKey));

  const lastByVantage = new Map<string, Date>();

  for (const probe of probes) {
    const seen = lastByVantage.get(probe.vantage);

    if (!seen || probe.probedAt > seen)
      lastByVantage.set(probe.vantage, probe.probedAt);
  }

  const vantages: VantageView[] = [...lastByVantage.entries()]
    .map(([name, at]) => ({
      name,
      lastProbeAt: at.toISOString(),
      stale: isStale(at),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const views: ChannelView[] = channels.map((channel) => {
    const cells: ProbeCell[] = mine
      .filter((probe) => probe.channelKey === channel.key)
      .map((probe) => ({
        vantage: probe.vantage,
        result: probe.result,
        tcpMs: probe.tcpMs,
        tlsMs: probe.tlsMs,
        detail: probe.detail,
        probedAt: probe.probedAt.toISOString(),
        changedAt: probe.changedAt.toISOString(),
        stale: isStale(probe.probedAt),
      }))
      .sort((a, b) => a.vantage.localeCompare(b.vantage));
    const fresh = cells.filter((cell) => !cell.stale);
    const good = fresh.filter((cell) => cell.result === 'ok');
    const bad = fresh.filter((cell) => cell.result !== 'ok');

    if (fresh.length === 0) {
      return { ...channel, state: 'unknown', cells, reason: null };
    }

    if (bad.length === 0) {
      return { ...channel, state: 'ok', cells, reason: null };
    }

    const why = RESULT_TEXT[bad[0].result];

    return good.length === 0
      ? {
          ...channel,
          state: 'down',
          cells,
          reason: `не доходит ни из одной точки: ${why}`,
        }
      : {
          ...channel,
          state: 'partial',
          cells,
          reason: `не доходит из: ${list(bad.map((cell) => cell.vantage))} — ${why}`,
        };
  });

  const reasons: string[] = [];
  const hasFresh = views.some((view) => view.state !== 'unknown');
  const live = views.filter(
    (view) => view.state === 'ok' || view.state === 'partial',
  );
  let status: ChannelsStatus = 'ok';

  if (views.length > 0 && !hasFresh) {
    status = 'warn';
    reasons.push(
      'Нет свежих проб каналов — проверка не запущена или не присылает данные',
    );
  } else if (views.length > 0 && live.length === 0) {
    status = 'bad';
    reasons.push('Ни один канал не доходит ни из одной точки');
  } else if (views.length > 1 && live.length === 1) {
    status = 'warn';
    reasons.push(`Остался один живой канал: ${live[0].name}`);
  }

  for (const view of views) {
    if (view.state === 'down' || view.state === 'partial') {
      if (status === 'ok') status = 'warn';
      reasons.push(`Канал ${view.name}: ${view.reason}`);
    }
  }

  for (const vantage of vantages) {
    if (vantage.stale) {
      if (status === 'ok') status = 'warn';
      reasons.push(`Точка «${vantage.name}» не присылает пробы`);
    }
  }

  return { status, reasons, channels: views, vantages };
}
