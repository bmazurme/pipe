// A worker's own VPN: the vless:// Reality link from the Worker page becomes an Xray client config — an HTTP proxy on
// loopback (HTTP, not SOCKS: the claude CLI and undici cannot use SOCKS5) and one VLESS+Reality outbound. The same shape as
// infra/bridge-pi/vless-to-xray.sh and bridge/deploy/swarm/xray-client-config.example.json.
export interface VlessParams {
  host: string;
  port: number;
  uuid: string;
  flow?: string;
  encryption: string;
  serverName: string;
  fingerprint: string;
  publicKey: string;
  shortId: string;
  spiderX: string;
}

export function parseVless(raw: string): VlessParams {
  let url: URL;

  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('not a vless:// link');
  }

  if (url.protocol !== 'vless:' || !url.hostname || !url.username) {
    throw new Error('not a vless://UUID@host:port?… link');
  }

  const q = url.searchParams;

  if (q.get('security') !== 'reality') throw new Error('the link is not security=reality');
  if ((q.get('type') ?? 'tcp') !== 'tcp') throw new Error(`transport "${q.get('type')}" is not supported — only tcp`);

  const need = (key: string): string => {
    const value = q.get(key);

    if (!value) throw new Error(`the link has no "${key}" — it must be a Reality link (pbk, sni, fp, sid)`);

    return value;
  };

  return {
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port: Number(url.port) || 443,
    uuid: decodeURIComponent(url.username),
    ...(q.get('flow') ? { flow: q.get('flow') as string } : {}),
    encryption: q.get('encryption') ?? 'none',
    serverName: need('sni'),
    fingerprint: q.get('fp') ?? 'chrome',
    publicKey: need('pbk'),
    shortId: q.get('sid') ?? '',
    spiderX: q.get('spx') ?? '/',
  };
}

// On the network these boards sit on the `chrome` TLS fingerprint was throttled — about 80% of connections through the tunnel
// hung until the connect timeout while `firefox` passed 48 of 48 (see infra/bridge-pi/vless-to-xray.sh, which has the same
// override). So the worker uses firefox whatever the link carries; WORKER_VPN_FINGERPRINT picks another one, and `link`
// keeps the link's own.
export const DEFAULT_FINGERPRINT = 'firefox';

// What the pool of a worker's tunnel is probed with: a URL that answers 204 fast from anywhere, asked through each exit.
export const PROBE_URL = 'https://www.gstatic.com/generate_204';
export const PROBE_INTERVAL = '1m';
export const POOL_TAG_PREFIX = 'node-';
const INBOUND_TAG = 'in';

function vlessOutbound(params: VlessParams, tag: string, fingerprint: string): object {
  return {
    tag,
    protocol: 'vless',
    settings: {
      vnext: [
        {
          address: params.host,
          port: params.port,
          users: [{ id: params.uuid, encryption: params.encryption, ...(params.flow ? { flow: params.flow } : {}) }],
        },
      ],
    },
    streamSettings: {
      network: 'tcp',
      security: 'reality',
      realitySettings: {
        serverName: params.serverName,
        fingerprint: fingerprint === 'link' ? params.fingerprint : fingerprint,
        publicKey: params.publicKey,
        shortId: params.shortId,
        spiderX: params.spiderX,
      },
    },
  };
}

// One link: a plain tunnel, as always. Several: every link is an outbound (node-1 … node-N), Xray probes each one through itself
// once a minute (observatory) and a balancer sends traffic to the one that answers fastest — so a blocked exit is left within
// a probe or two, with nothing for the worker or bridge to decide. If every probe fails the balancer falls back to node-1
// rather than to no route at all.
export function buildXrayConfig(links: VlessParams | VlessParams[], listenPort: number, fingerprint: string = DEFAULT_FINGERPRINT): object {
  const pool = Array.isArray(links) ? links : [links];
  const base = {
    log: { loglevel: 'warning' },
    // Loopback only: the tunnel is for this worker's own processes, never for the network around it.
    inbounds: [{ tag: INBOUND_TAG, listen: '127.0.0.1', port: listenPort, protocol: 'http' }],
  };

  if (pool.length === 1) {
    return { ...base, outbounds: [vlessOutbound(pool[0], `${POOL_TAG_PREFIX}1`, fingerprint)] };
  }

  return {
    ...base,
    outbounds: pool.map((params, index) => vlessOutbound(params, `${POOL_TAG_PREFIX}${index + 1}`, fingerprint)),
    observatory: {
      subjectSelector: [POOL_TAG_PREFIX],
      probeUrl: PROBE_URL,
      probeInterval: PROBE_INTERVAL,
      enableConcurrency: true,
    },
    routing: {
      domainStrategy: 'AsIs',
      balancers: [{ tag: 'pool', selector: [POOL_TAG_PREFIX], strategy: { type: 'leastPing' }, fallbackTag: `${POOL_TAG_PREFIX}1` }],
      rules: [{ type: 'field', inboundTag: [INBOUND_TAG], balancerTag: 'pool' }],
    },
  };
}
