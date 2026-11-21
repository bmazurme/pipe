// The bridge's own VPN tunnel: the vless:// Reality links of the VPN page's active connection become an Xray client config — an HTTP
// proxy on loopback (undici and fetch cannot use SOCKS) and VLESS+Reality outbounds. The same shape as the worker's tunnel
// (worker/src/vpn/vless.ts), which has been running on the boards: one link is a plain tunnel; several are balanced by Xray itself
// (each exit is probed through itself once a minute, traffic goes to the one that answers fastest, node-1 when none does).
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

  if (q.get('security') !== 'reality') {
    throw new Error('the link is not security=reality');
  }

  if ((q.get('type') ?? 'tcp') !== 'tcp') {
    throw new Error(`transport "${q.get('type')}" is not supported — only tcp`);
  }

  const need = (key: string): string => {
    const value = q.get(key);

    if (!value) {
      throw new Error(
        `the link has no "${key}" — it must be a Reality link (pbk, sni, fp, sid)`,
      );
    }

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

// On the network these boards sit on the `chrome` TLS fingerprint was throttled (about 80% of connections hung) while `firefox` passed
// 48 of 48 — the worker and infra/bridge-pi/vless-to-xray.sh override it the same way. `link` keeps the link's own.
export const DEFAULT_FINGERPRINT = 'firefox';
export const PROBE_URL = 'https://www.gstatic.com/generate_204';
export const POOL_TAG_PREFIX = 'node-';
const INBOUND_TAG = 'in';

function vlessOutbound(
  params: VlessParams,
  tag: string,
  fingerprint: string,
): object {
  return {
    tag,
    protocol: 'vless',
    settings: {
      vnext: [
        {
          address: params.host,
          port: params.port,
          users: [
            {
              id: params.uuid,
              encryption: params.encryption,
              ...(params.flow ? { flow: params.flow } : {}),
            },
          ],
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

export function buildXrayConfig(
  links: VlessParams | VlessParams[],
  listenPort: number,
  fingerprint: string = DEFAULT_FINGERPRINT,
): object {
  const pool = Array.isArray(links) ? links : [links];
  const base = {
    log: { loglevel: 'warning' },
    // Loopback only: the tunnel is for this backend's own requests, never for the network around it.
    inbounds: [
      {
        tag: INBOUND_TAG,
        listen: '127.0.0.1',
        port: listenPort,
        protocol: 'http',
      },
    ],
  };

  if (pool.length === 1) {
    return {
      ...base,
      outbounds: [vlessOutbound(pool[0], `${POOL_TAG_PREFIX}1`, fingerprint)],
    };
  }

  return {
    ...base,
    outbounds: pool.map((params, index) =>
      vlessOutbound(params, `${POOL_TAG_PREFIX}${index + 1}`, fingerprint),
    ),
    observatory: {
      subjectSelector: [POOL_TAG_PREFIX],
      probeUrl: PROBE_URL,
      probeInterval: '1m',
      enableConcurrency: true,
    },
    routing: {
      domainStrategy: 'AsIs',
      balancers: [
        {
          tag: 'pool',
          selector: [POOL_TAG_PREFIX],
          strategy: { type: 'leastPing' },
          fallbackTag: `${POOL_TAG_PREFIX}1`,
        },
      ],
      rules: [
        { type: 'field', inboundTag: [INBOUND_TAG], balancerTag: 'pool' },
      ],
    },
  };
}
