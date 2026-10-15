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

export function buildXrayConfig(params: VlessParams, listenPort: number): object {
  return {
    log: { loglevel: 'warning' },
    // Loopback only: the tunnel is for this worker's own processes, never for the network around it.
    inbounds: [{ listen: '127.0.0.1', port: listenPort, protocol: 'http' }],
    outbounds: [
      {
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
            fingerprint: params.fingerprint,
            publicKey: params.publicKey,
            shortId: params.shortId,
            spiderX: params.spiderX,
          },
        },
      },
    ],
  };
}
